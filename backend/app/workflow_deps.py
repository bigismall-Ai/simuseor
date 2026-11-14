"""工作流依赖比对：这条工作流跑起来还缺什么。

两类依赖，口径不同：

**模型** —— 按文件名精确匹配 `workspace/models/<directory>/`。工作流要
`flux1-dev.sft`，目录里有同名文件就算有。
不做「同族不同版本算命中」的宽松匹配：`flux1-dev-Q4_K_M.gguf` 和
`flux1-dev.sft` 是两个不同的文件，前者在不在不改变「后者缺失」的事实。
宽松匹配会让用户以为能跑，进画布照样报错。

**节点包** —— 复用 nodes.py 的 owner 索引（5731 仓库 → 45849 节点类），
从工作流用到的节点类型反查「这个类由哪个包提供」，再看该包装没装。
查不到归属的节点单列成 unknown：如实说「不知道」，不猜。

**输入图不算依赖** —— LoadImage 指向的是用户私有素材，没有可下载的来源。
它属于「使用工作流」的前置检查，不进依赖清单。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import WORKSPACE_MODELS_DIR
from . import nodes as node_service


# 只认模型文件。目录里还混着 config.json / tokenizer.json 这类配套文件，
# 以及下载中的 `.aria2` / `.part` 临时文件 —— 把它们算进索引会让「缺模型」
# 的判断没有意义（甚至在下载没完成时就谎报「已有」）。
_MODEL_SUFFIX = (
    ".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin", ".onnx",
)


def _model_index() -> dict[str, str]:
    """{小写文件名: 相对目录}，扫一遍 workspace/models 下所有模型文件。

    小写是因为 Windows 文件系统不区分大小写；工作流里写 `Flux1-dev.sft`
    而磁盘上是 `flux1-dev.sft` 时必须算命中。
    """
    index: dict[str, str] = {}
    root = WORKSPACE_MODELS_DIR
    if not root.is_dir():
        return index
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        name = path.name
        if name.startswith(".") or not name.lower().endswith(_MODEL_SUFFIX):
            continue
        try:
            rel = path.parent.relative_to(root).as_posix()
        except ValueError:
            rel = ""
        index[name.lower()] = rel
    return index


def _dir_for(slot: dict, index: dict[str, str]) -> str:
    """这个模型槽位该去哪个目录找。档案里写的目录优先，找不到就用文件名反查。"""
    declared = (slot.get("directory") or "").strip()
    if declared:
        return declared
    return index.get(str(slot.get("file") or "").lower(), "")


def model_deps(slots: list[dict], index: dict[str, str] | None = None) -> dict:
    """模型依赖：哪些有、哪些缺。"""
    idx = index if index is not None else _model_index()
    have: list[dict] = []
    missing: list[dict] = []
    for slot in slots:
        name = str(slot.get("file") or "").strip()
        if not name:
            continue
        directory = _dir_for(slot, idx)
        entry = {
            "file": name,
            "directory": directory,
            "node": str(slot.get("node") or ""),
            "url": str(slot.get("url") or ""),
        }
        if name.lower() in idx:
            entry["found_dir"] = idx[name.lower()]
            have.append(entry)
        else:
            missing.append(entry)
    return {"have": have, "missing": missing}


def node_deps(classes: set[str], installed: dict[str, dict] | None = None) -> dict:
    """节点包依赖：从工作流用到的节点类型反查「缺哪个包」。

    返回 providers（缺的包，可直接跳去装）、unknown（清单里查不到归属的类）。
    """
    if not classes:
        return {"have": [], "missing": [], "unknown": []}

    data = node_service.catalog()
    owner: dict[str, str] = data.get("owner") or {}
    by_id: dict[str, dict] = data.get("by_id") or {}
    core: set[str] = data.get("core") or set()

    have_pkgs = installed if installed is not None else node_service.installed_index()
    installed_ids = {
        item.get("id") for item in have_pkgs.values() if item.get("id")
    }

    # 节点类 -> 所属仓库（跳过核心节点：ComfyUI 自带，不用装）
    by_repo: dict[str, list[str]] = {}
    unknown: list[str] = []
    for name in sorted(classes):
        if name in core:
            continue
        repo = owner.get(name)
        if not repo:
            unknown.append(name)
            continue
        by_repo.setdefault(repo, []).append(name)

    missing: list[dict] = []
    have: list[dict] = []
    for repo, covered in sorted(by_repo.items()):
        item = by_id.get(repo) or {}
        entry = {
            "id": repo,
            "name": item.get("name") or repo.split("/")[-1],
            "author": item.get("author") or "",
            "repo": item.get("repo") or "",
            "node_count": item.get("node_count") or 0,
            "installable": bool(item.get("installable")),
            "covers": covered,
        }
        if repo in installed_ids:
            have.append(entry)
        else:
            missing.append(entry)

    return {"have": have, "missing": missing, "unknown": unknown}


def analyze(
    slots: list[dict],
    classes: set[str],
    *,
    model_index: dict[str, str] | None = None,
    installed: dict[str, dict] | None = None,
) -> dict:
    """一次算完这条工作流的全部依赖，并给出该走哪个生命周期操作。

    state 只有四态，与卡片方案一一对应：
      broken  语法坏掉，只能去编辑器里修
      api     API 格式，载不进画布
      missing 缺模型或节点包，先补齐
      ready   齐全，可以开始干活
    """
    models = model_deps(slots, model_index)
    nodes = node_deps(classes, installed)
    missing_count = len(models["missing"]) + len(nodes["missing"])
    return {
        "models": models,
        "nodes": nodes,
        "missing_count": missing_count,
        "ready": missing_count == 0,
        # 提醒：输入图不在这里，它属于「使用工作流」的前置检查
        "state": "missing" if missing_count else "ready",
    }
