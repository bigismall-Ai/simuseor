"""工作流封面：本地优先、社区兜底、同底模去重。

口径要点：
- 本地有图就不该再去网上问（省一次请求，也避免被社区图覆盖掉真实出图）
- 社区搜索结果必须与工作流名有足够重合才采用 —— 宁可没封面也不能贴错图
- 同一底模的多条工作流要发不同的图，否则三张卡长得一模一样
"""
from __future__ import annotations

import base64
import pathlib

import pytest

from app import workflow_covers as wc


@pytest.fixture(autouse=True)
def _clean_cache(tmp_path, monkeypatch):
    """每个用例一份独立缓存，断言之间不互相污染。"""
    monkeypatch.setattr(wc, "COVERS_PATH", tmp_path / "covers.json")
    monkeypatch.setattr(wc, "BLOB_DIR", tmp_path / "blobs")
    wc.reset_cache()
    yield
    wc.reset_cache()


# ---------------- 本地封面 ----------------

def test_local_cover_prefers_same_stem(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    wf = tmp_path / "demo.json"
    wf.write_text("{}", encoding="utf-8")
    (tmp_path / "demo.png").write_bytes(b"x")
    (tmp_path / "preview.jpg").write_bytes(b"x")

    url = wc.local_cover(str(wf))

    assert "demo.png" in url
    assert url.startswith("/api/workflows/local/cover?path=")


def test_local_cover_falls_back_to_preview_name(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    wf = tmp_path / "demo.json"
    wf.write_text("{}", encoding="utf-8")
    (tmp_path / "preview.webp").write_bytes(b"x")

    assert "preview.webp" in wc.local_cover(str(wf))


def test_local_cover_returns_empty_without_image(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    wf = tmp_path / "demo.json"
    wf.write_text("{}", encoding="utf-8")
    assert wc.local_cover(str(wf)) == ""


def test_local_cover_extracts_data_uri(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    wf = tmp_path / "demo.json"
    wf.write_text("{}", encoding="utf-8")
    raw = b"\x89PNG" + b"\x00" * 512
    payload = {"extra": {"preview": "data:image/png;base64," + base64.b64encode(raw).decode()}}

    url = wc.local_cover(str(wf), payload)

    assert url.startswith("/api/workflows/local/cover?path=")
    assert "blobs" in url
    assert (tmp_path / "blobs").is_dir()


def test_local_cover_ignores_tiny_data_uri(tmp_path, monkeypatch):
    """几个字节的 data URI 是占位符，不是图。"""
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    wf = tmp_path / "demo.json"
    wf.write_text("{}", encoding="utf-8")
    payload = {"extra": {"preview": "data:image/png;base64,AAAA"}}
    assert wc.local_cover(str(wf), payload) == ""


# ---------------- 本地图服务 ----------------

def test_serve_file_allows_workflow_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    img = tmp_path / "a.png"
    img.write_bytes(b"x")
    assert wc.serve_file(str(img)) == img.resolve()


def test_serve_file_rejects_outside(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path / "wf")
    (tmp_path / "wf").mkdir()
    outside = tmp_path / "secret.png"
    outside.write_bytes(b"x")
    with pytest.raises(PermissionError):
        wc.serve_file(str(outside))


def test_serve_file_rejects_non_image(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    f = tmp_path / "notes.txt"
    f.write_text("hi", encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        wc.serve_file(str(f))


# ---------------- 查询词归一化 ----------------

def test_model_query_strips_quant_suffix():
    assert wc._model_query("flux1-dev.sft") == "flux1 dev"
    # int8 / convrot 这类精度标记搜不到东西，先剔掉；纯数字也丢（版本号对搜索没帮助）
    assert wc._model_query("qwen_image_2.1_int8_convrot.safetensors") == "qwen image"
    assert wc._model_query("") == ""


def test_tokens_drop_stopwords_and_numbers():
    got = wc._tokens("comfyui_flux_img2img_1_2")
    assert "flux" in got
    assert "comfyui" not in got  # 每个工作流都叫这个，没有区分度
    assert "2" not in got


# ---------------- 社区取图 ----------------

def _workflow_item(name: str, images: list[dict]) -> dict:
    return {"name": name, "modelVersions": [{"images": images}]}


def _img(url: str, w: int = 1280, h: int = 800, level: int = 1, meta: bool = True) -> dict:
    out = {"url": url, "width": w, "height": h, "nsfwLevel": level, "type": "image"}
    if meta:
        out["meta"] = {"prompt": "x", "Model": "flux"}
    return out


def test_workflow_search_needs_two_tokens(monkeypatch):
    """名字不重合的结果不能用 —— 贴错图比没封面更糟。"""
    calls: list[dict] = []

    def fake_get(params, cfg, timeout=9.0):
        calls.append(params)
        return [_workflow_item("完全无关的东西", [_img("https://x/other.jpg")])]

    monkeypatch.setattr(wc, "_get", fake_get)
    assert wc._workflow_cover("image_qwen_image_2_1_image_edit", {}) == ""
    assert calls  # 确实问过，只是结果不合格


def test_workflow_search_accepts_matching_name(monkeypatch):
    def fake_get(params, cfg, timeout=9.0):
        # 搜索词里必须带 qwen/image/edit 这类有效 token
        assert "qwen" in params["query"]
        return [
            _workflow_item("无关条目", [_img("https://x/bad.jpg")]),
            _workflow_item("Qwen Image Edit Plus", [_img("https://x/good.jpg")]),
        ]

    monkeypatch.setattr(wc, "_get", fake_get)
    assert wc._workflow_cover("image_qwen_image_2_1_image_edit", {}) == "https://x/good.jpg"


def test_workflow_search_rejects_canvas_screenshots(monkeypatch):
    """工作流条目里不带生成参数的图基本是「画布截图 + 成图」拼接版，不能当封面。"""

    def fake_get(params, cfg, timeout=9.0):
        return [_workflow_item("Qwen Image Edit Plus", [_img("https://x/canvas.jpg", meta=False)])]

    monkeypatch.setattr(wc, "_get", fake_get)
    assert wc._workflow_cover("image_qwen_image_2_1_image_edit", {}) == ""


def test_ranked_images_prefers_landscape_and_skips_mature(monkeypatch):
    item = {
        "modelVersions": [
            {
                "images": [
                    _img("https://x/portrait.jpg", 800, 1280),
                    _img("https://x/adult.jpg", 1280, 800, level=8),
                    _img("https://x/wide.jpg", 1280, 800),
                ]
            }
        ]
    }
    got = wc._ranked_images(item, allow_mature=False)
    assert got[0] == "https://x/wide.jpg"
    assert all("adult" not in url for url in got)


def test_pool_gives_different_images_to_same_model(monkeypatch):
    """同一底模的两条工作流不能拿到同一张图。"""
    pool = ["https://x/one.jpg", "https://x/two.jpg"]

    monkeypatch.setattr(wc, "_pool", lambda model, cfg: list(pool))
    first = wc._pool_cover("a.json", "flux1-dev.sft", {})
    wc._remember("a.json", first, origin="flux1-dev.sft")
    second = wc._pool_cover("b.json", "flux1-dev.sft", {})

    assert first == "https://x/one.jpg"
    assert second == "https://x/two.jpg"


def test_pool_reuses_images_when_exhausted(monkeypatch):
    monkeypatch.setattr(wc, "_pool", lambda model, cfg: ["https://x/only.jpg"])
    first = wc._pool_cover("a.json", "m.sft", {})
    wc._remember("a.json", first, origin="m.sft")
    # 池子只有一张时宁可用同一张，也不能返回空
    assert wc._pool_cover("b.json", "m.sft", {}) == "https://x/only.jpg"


def test_resolve_batch_hits_cache(monkeypatch):
    calls: list[str] = []

    def fake_search(name, cfg):
        calls.append(name)
        return "https://x/cached.jpg"

    monkeypatch.setattr(wc, "_workflow_cover", fake_search)
    entries = [{"key": "a.json", "name": "flux img2img", "model": ""}]

    assert wc.resolve_batch(entries) == {"a.json": "https://x/cached.jpg"}
    assert wc.resolve_batch(entries) == {"a.json": "https://x/cached.jpg"}
    assert len(calls) == 1  # 第二次走缓存，不再打网络


def test_resolve_batch_remembers_misses(monkeypatch):
    calls: list[str] = []

    def fake_search(name, cfg):
        calls.append(name)
        return ""

    monkeypatch.setattr(wc, "_workflow_cover", fake_search)
    entries = [{"key": "a.json", "name": "nothing here", "model": ""}]

    assert wc.resolve_batch(entries) == {}
    assert wc.resolve_batch(entries) == {}
    # 未命中也要记，否则每次进页面都重问一遍没有封面的那批
    assert len(calls) == 1
