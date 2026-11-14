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


def test_ranked_images_skips_wide_collages(monkeypatch):
    """三联转面 / 左右对比图：比例越大越容易被「接近 16:10」排到前面，必须挡住。"""
    item = {
        "modelVersions": [
            {
                "images": [
                    _img("https://x/triple.jpg", 1344, 448),  # 3.0 → 三联
                    _img("https://x/single.jpg", 832, 1216),  # 0.68 → 单张竖图
                ]
            }
        ]
    }
    got = wc._ranked_images(item, allow_mature=False)
    assert got == ["https://x/single.jpg"]


def test_rename_key_keeps_cover(monkeypatch):
    """改文件名不该换封面：缓存键是相对路径，键要跟着文件搬。"""
    wc._remember("folder/old.json", "https://x/keep.jpg", origin="m.sft")

    assert wc.rename_key("folder/old.json", "folder/新名字.json") is True
    assert wc._cached_url("folder/新名字.json") == "https://x/keep.jpg"
    assert wc._cached_url("folder/old.json") is None


def test_rename_key_ignores_unknown_key():
    assert wc.rename_key("nope.json", "other.json") is False
    assert wc.rename_key("same.json", "same.json") is False


def test_forget_drops_entry():
    wc._remember("a.json", "https://x/a.jpg", origin="m")

    assert wc.forget("a.json") is True
    assert wc._cached_url("a.json") is None
    assert wc.forget("a.json") is False


def test_pool_gives_different_images_to_same_model(monkeypatch):
    """同一底模的两条工作流不能拿到同一张图。"""
    pool = ["https://x/one.jpg", "https://x/two.jpg"]

    monkeypatch.setattr(wc, "_pool", lambda model, cfg: list(pool))
    first = wc._pool_cover("a.json", "flux1-dev.sft", {})
    wc._remember("a.json", first, origin="flux1-dev.sft")
    second = wc._pool_cover("b.json", "flux1-dev.sft", {})

    assert {first, second} == set(pool)


def test_pool_pick_is_stable_for_same_key(monkeypatch):
    """重抽不能整批洗牌：同一条工作流、同一个池子，永远同一张。"""
    urls = [f"https://x/{i}.jpg" for i in range(6)]

    monkeypatch.setattr(wc, "_pool", lambda model, cfg: list(urls))
    first = wc._pool_cover("K/人像.json", "m.sft", {})
    wc.reset_cache()  # 进程重启 / 缓存重读之后
    again = wc._pool_cover("K/人像.json", "m.sft", {})

    assert first == again
    assert first in urls


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


# ---------------- 手动换一张 / 钉住 ----------------

_ENTRY = {"key": "a.json", "name": "flux img2img", "model": "flux1-dev.sft"}


def _four_images(monkeypatch):
    urls = [f"https://x/p{i}.jpg" for i in range(4)]
    monkeypatch.setattr(wc, "_workflow_cover", lambda name, cfg: "")
    monkeypatch.setattr(wc, "_pool", lambda model, cfg: urls)
    return urls


def test_redeal_avoids_current_image_and_pins(monkeypatch):
    _four_images(monkeypatch)

    first = wc.redeal(_ENTRY)
    assert first
    assert wc.pinned("a.json") == first

    second = wc.redeal(_ENTRY, current=first)
    assert second and second != first
    assert wc.pinned("a.json") == second
    assert wc.pinned_keys() == ["a.json"]


def test_pinned_cover_beats_local_preview(monkeypatch):
    urls = _four_images(monkeypatch)
    wc.pin("a.json", urls[0])

    # has_local=True 本来该跳过，钉过的图仍要返回 —— 这是「换一张」能盖住自带出图的关键
    assert wc.resolve_batch([{**_ENTRY, "has_local": True}]) == {"a.json": urls[0]}

    wc.unpin("a.json")
    assert wc.resolve_batch([{**_ENTRY, "has_local": True}]) == {}


def test_local_preview_is_not_queried(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("本地自带出图的条目不该去社区问")

    monkeypatch.setattr(wc, "_get", boom)
    assert wc.resolve_batch([{**_ENTRY, "has_local": True}]) == {}


def test_forget_clears_pin_too():
    wc.pin("a.json", "https://x/one.jpg")
    assert wc.forget("a.json") is True
    assert wc.pinned("a.json") == ""
    assert wc.pinned_keys() == []


def test_rename_key_moves_pin():
    wc.pin("old/a.json", "https://x/one.jpg")
    assert wc.rename_key("old/a.json", "new/a.json") is True
    assert wc.pinned("new/a.json") == "https://x/one.jpg"
    assert wc.pinned("old/a.json") == ""


# ---------------- 自定义封面 ----------------

_PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 240


def _data_uri(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def test_custom_url_is_pinned_as_custom():
    url = wc.set_custom("a.json", url="https://img.example/cover.png")

    assert url == "https://img.example/cover.png"
    assert wc.pinned("a.json") == url
    assert wc.pin_source("a.json") == "custom"
    assert wc.custom_keys() == ["a.json"]
    # 自定义图连工作流自带的出图也盖得过
    assert wc.resolve_batch([{**_ENTRY, "has_local": True}]) == {"a.json": url}


def test_custom_upload_is_saved_and_served_locally(tmp_path):
    cover = wc.set_custom("nested/a.json", data=_data_uri("image/png", _PNG))

    assert cover.startswith("/api/workflows/local/cover?path=")
    path = pathlib.Path(cover.split("path=", 1)[1])
    assert path.is_file()
    assert path.parent == wc.BLOB_DIR
    assert path.read_bytes() == _PNG
    assert wc.serve_file(str(path)) == path
    assert wc.pin_source("nested/a.json") == "custom"


def test_custom_rejects_unsafe_inputs(monkeypatch):
    bad = [
        {"url": "javascript:alert(1)"},
        {"url": "file:///C:/secret.png"},
        {"url": "https://user:pw@img.example/a.png"},
        {"data": _data_uri("text/html", b"<script>x</script>" * 20)},
        {"data": _data_uri("image/png", b"not a png" * 40)},
        {"data": _data_uri("image/png", b"\x89PNG\r\n\x1a\n" + b"x" * 10)},
    ]
    for kwargs in bad:
        with pytest.raises(ValueError):
            wc.set_custom("a.json", **kwargs)

    with pytest.raises(ValueError):
        wc.set_custom("", url="https://img.example/a.png")

    monkeypatch.setattr(wc, "MAX_CUSTOM_BYTES", 100)
    with pytest.raises(ValueError):
        wc.set_custom("a.json", data=_data_uri("image/png", _PNG))
    assert wc.pinned_keys() == []


def test_restore_auto_clears_manual_result(monkeypatch):
    _four_images(monkeypatch)
    first = wc.redeal(_ENTRY)
    assert first

    assert wc.restore_auto("a.json") is True
    assert wc.pinned("a.json") == ""
    assert wc.pin_source("a.json") == ""
    assert wc.custom_keys() == []
    # 只 unpin 的话 seen 里那张手动图会当成「自动命中」立刻回来
    assert wc._cached_url("a.json") is None
    auto = wc.resolve_batch([_ENTRY])
    assert "a.json" in auto
    assert wc.pinned("a.json") == ""  # 重新抽出来的图没有钉住


def test_rename_key_keeps_custom_source():
    wc.set_custom("old/a.json", url="https://img.example/cover.png")
    assert wc.rename_key("old/a.json", "new/a.json") is True
    assert wc.pin_source("new/a.json") == "custom"
    assert wc.custom_keys() == ["new/a.json"]
