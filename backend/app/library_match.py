"""按「名字 + safetensors 头」自动匹配导入模型的来源。

纯名字匹配会误链：同一个名字可能是不同人重训的模型。这里在候选仓库里找到
同名权重文件后，再读**远端文件头**（Range 请求，只取前几 MB），把
tensor 名 / dtype / shape 的 schema 指纹和本地头比对 —— 完全一致才认。

只处理 safetensors：
- 头是自描述的 JSON，比对可靠；
- `.ckpt` / `.bin` 是 pickle，读不出稳定 schema；
- GGUF 头不是 JSON，暂不参与自动匹配。

没有匹配就返回 None，保持 imported，不猜。
"""
from __future__ import annotations

import json
import re
import struct
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from .config import load_settings
from .source_urls import source_page_url
from .sources import get_adapter
from .sources.base import SourceError
from .weight_meta import pick_weight_file, read_weight

# 候选来源的优先级：能拿到精确版本页的排前面
_SOURCES = ("huggingface", "modelscope", "civitai")
_HEADER_MAX = 100 * 1024 * 1024  # safetensors 头不可能超过 100 MB
_MAX_CANDIDATES = 8
_MAX_FILES = 4


def _norm(name: str) -> str:
    """名字归一：大小写、下划线/连字符/空格都不参与比较。"""
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def _basename(path: str) -> str:
    return (path or "").replace("\\", "/").rsplit("/", 1)[-1]


def local_fingerprint(directory: Path) -> dict | None:
    """本地权重文件的头指纹。不是 safetensors 或读不出头就返回 None。"""
    weight = pick_weight_file(directory)
    if weight is None or weight.suffix.lower() not in (".safetensors", ".sft"):
        return None
    info = read_weight(weight)
    if not info or not info.get("schemaHash"):
        return None
    try:
        size = weight.stat().st_size
    except OSError:
        size = 0
    return {
        "file": weight,
        "name": weight.name,
        "size": size,
        "schema": info["schemaHash"],
        "params": info.get("params") or 0,
        "tensors": info.get("tensors") or 0,
    }


def _search_once(q: str, settings: dict) -> list[dict]:
    """一个关键词同时搜三个源，只保留**归一化名字完全一致**的条目。"""
    target = _norm(q)
    if not target:
        return []

    def run(source: str) -> list[dict]:
        cfg = settings["sources"].get(source) or {}
        try:
            res = get_adapter(source).search(q, 20, 1, "downloads", cfg)
        except (SourceError, httpx.HTTPError):
            return []
        out = []
        for item in res.get("items") or []:
            repo_id = item.get("id") or ""
            if repo_id and _norm(item.get("name") or "") == target:
                out.append({"source": source, "repo_id": repo_id, "name": item.get("name") or ""})
        return out

    with ThreadPoolExecutor(max_workers=len(_SOURCES)) as pool:
        results = list(pool.map(run, _SOURCES))

    order = {name: i for i, name in enumerate(_SOURCES)}
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for group in results:
        for item in group:
            key = (item["source"], item["repo_id"])
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    merged.sort(key=lambda x: order.get(x["source"], 99))
    return merged[:_MAX_CANDIDATES]


def _candidates(directory_name: str, file_stem: str, settings: dict) -> list[dict]:
    """先用目录名搜；搜不到再用权重文件名搜。"""
    found = _search_once(directory_name, settings)
    if found:
        return found
    if file_stem and _norm(file_stem) != _norm(directory_name):
        return _search_once(file_stem, settings)
    return []


def _remote_files(candidate: dict, local: dict, settings: dict):
    """在候选仓库里挑要比对的文件。

    优先同名文件（最可靠）；找不到同名时，把 safetensors 按体积接近程度
    排序取前几个 —— 用户可能改过文件名，最终仍由头指纹决定。
    """
    source = candidate["source"]
    cfg = settings["sources"].get(source) or {}
    try:
        repo = get_adapter(source).resolve(candidate["repo_id"], "", cfg)
    except (SourceError, httpx.HTTPError):
        return None, []

    exact = [f for f in repo.files if _basename(f.path).lower() == local["name"].lower()]
    if exact:
        return repo, exact[:_MAX_FILES]

    st = [f for f in repo.files if f.path.lower().endswith((".safetensors", ".sft"))]
    st.sort(key=lambda f: abs((f.size or 0) - local["size"]))
    return repo, st[:_MAX_FILES]


def _read_at_most(resp: httpx.Response, limit: int) -> bytes:
    """流式读最多 limit 字节，然后断开。

    httpx 的 `Response.read()` 没有长度参数；直接 read() 会把整个响应吞下来。
    对于 10 GB 的权重，服务器一旦忽略 Range 返回 200，那就是灾难。
    """
    chunks: list[bytes] = []
    total = 0
    for chunk in resp.iter_bytes():
        if not chunk:
            continue
        take = chunk[: limit - total]
        chunks.append(take)
        total += len(take)
        if total >= limit:
            break
    return b"".join(chunks)


def _remote_schema_hash(urls: list[str]) -> str | None:
    """只读远端 safetensors 头，算 schema 指纹。

    用 Range 流式读取：即使服务器忽略 Range 返回整个文件，也只会读到头那几 MB
    就断开，不会把 10 GB 权重拉下来。
    """
    if not urls:
        return None
    headers = {"User-Agent": "model-downloader/0.1"}
    for url in urls[:2]:
        try:
            with httpx.Client(timeout=20.0, follow_redirects=True, headers=headers) as client:
                with client.stream("GET", url, headers={"Range": "bytes=0-7"}) as resp:
                    if resp.status_code not in (200, 206):
                        continue
                    first = _read_at_most(resp, 8)
                if len(first) < 8:
                    continue
                length = struct.unpack("<Q", first)[0]
                if not (0 < length <= _HEADER_MAX):
                    continue
                with client.stream(
                    "GET", url, headers={"Range": f"bytes=0-{7 + length}"}
                ) as resp:
                    if resp.status_code not in (200, 206):
                        continue
                    blob = _read_at_most(resp, 8 + length)
                if len(blob) < 8 + length:
                    continue
                header = json.loads(blob[8:8 + length])
                if not isinstance(header, dict):
                    continue
                from .weight_meta import schema_hash

                return schema_hash(header)
        except (httpx.HTTPError, ValueError, struct.error, OSError):
            continue
    return None


def match_origin(directory: Path) -> dict | None:
    """返回 `{source, repo_id, revision, source_url}`；匹不上返回 None。"""
    local = local_fingerprint(directory)
    if local is None:
        return None

    settings = load_settings()
    candidates = _candidates(directory.name, local["file"].stem, settings)
    for candidate in candidates:
        repo, files = _remote_files(candidate, local, settings)
        if repo is None or not files:
            continue
        for remote in files:
            remote_hash = _remote_schema_hash(remote.candidates)
            if remote_hash and remote_hash == local["schema"]:
                url = source_page_url(candidate["source"], candidate["repo_id"], repo.revision)
                if not url:
                    continue
                return {
                    "source": candidate["source"],
                    "repo_id": candidate["repo_id"],
                    "revision": repo.revision or "",
                    "source_url": url,
                }
    return None
