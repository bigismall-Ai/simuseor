"""封面解析：取图顺序、HF 文件名启发式、魔搭 OSS 缩放、落盘缓存。"""
from __future__ import annotations

import app.covers as covers


def reset(monkeypatch, tmp_path):
    """把缓存文件指到临时目录，并清掉模块内的内存副本。"""
    path = tmp_path / "covers.json"
    monkeypatch.setattr(covers, "COVERS_PATH", path)
    monkeypatch.setattr(covers, "_store", None)
    return path


def test_prefers_modelscope_over_huggingface_and_civitai(monkeypatch, tmp_path):
    reset(monkeypatch, tmp_path)
    calls = []
    monkeypatch.setitem(covers._RESOLVERS, "modelscope", lambda rid, cfg: calls.append("ms") or "https://ms/1.jpg")
    monkeypatch.setitem(covers._RESOLVERS, "huggingface", lambda rid, cfg: calls.append("hf") or "https://hf/1.jpg")
    got = covers.resolve_group(
        [
            {"source": "huggingface", "id": "a/b"},
            {"source": "modelscope", "id": "a/b"},
            {"source": "civitai", "id": "1", "image": "https://cv/1.jpg"},
        ],
        {},
    )
    assert got == "https://ms/1.jpg"
    assert calls == ["ms"]  # 命中即停，不该再问 HF


def test_falls_through_to_civitai_without_extra_request(monkeypatch, tmp_path):
    reset(monkeypatch, tmp_path)
    monkeypatch.setitem(covers._RESOLVERS, "modelscope", lambda rid, cfg: "")

    def boom(*_a):
        raise AssertionError("Civitai 的图搜索响应里已带上，不该再打详情接口")

    monkeypatch.setitem(covers._RESOLVERS, "civitai", boom)
    got = covers.resolve_group(
        [{"source": "modelscope", "id": "a/b"}, {"source": "civitai", "id": "1", "image": "https://cv/1.jpg"}],
        {},
    )
    assert got == "https://cv/1.jpg"


def test_miss_is_cached_so_it_is_not_asked_twice(monkeypatch, tmp_path):
    reset(monkeypatch, tmp_path)
    hits = []

    def slow(rid, cfg):
        hits.append(rid)
        return ""

    monkeypatch.setitem(covers._RESOLVERS, "huggingface", slow)
    assert covers.resolve("huggingface", "a/b", {}) == ""
    assert covers.resolve("huggingface", "a/b", {}) == ""
    assert hits == ["a/b"]  # 第二次走缓存，不再请求


def test_cache_survives_process_restart(monkeypatch, tmp_path):
    path = reset(monkeypatch, tmp_path)
    monkeypatch.setitem(covers._RESOLVERS, "huggingface", lambda rid, cfg: "https://hf/1.jpg")
    covers.resolve("huggingface", "a/b", {})
    assert path.exists()

    # 模拟重启：丢掉内存副本，从磁盘重新读
    monkeypatch.setattr(covers, "_store", None)
    monkeypatch.setitem(covers._RESOLVERS, "huggingface", lambda rid, cfg: "https://wrong/2.jpg")
    assert covers.resolve("huggingface", "a/b", {}) == "https://hf/1.jpg"


def test_expired_entry_is_refetched(monkeypatch, tmp_path):
    reset(monkeypatch, tmp_path)
    monkeypatch.setattr(covers, "TTL_HIT", -1)  # 立刻过期
    monkeypatch.setitem(covers._RESOLVERS, "huggingface", lambda rid, cfg: "https://hf/1.jpg")
    covers.resolve("huggingface", "a/b", {})
    monkeypatch.setitem(covers._RESOLVERS, "huggingface", lambda rid, cfg: "https://hf/2.jpg")
    assert covers.resolve("huggingface", "a/b", {}) == "https://hf/2.jpg"


def test_hf_pick_prefers_cover_like_names():
    files = ["README.md", "assets/1_figurine.png", "teaser.jpg", "logo.png", "chart.png"]
    assert covers._hf_pick(files) == "teaser.jpg"


def test_hf_pick_skips_logos():
    assert covers._hf_pick(["logo.png", "icon.png"]) == ""
    assert covers._hf_pick(["assets/cover_banner.webp"]) == "assets/cover_banner.webp"


def test_hf_pick_prefers_keyword_over_location():
    # 关键字优先于位置：assets/demo.png 比根目录的普通文件名更像封面
    assert covers._hf_pick(["assets/demo.png", "photo.png"]) == "assets/demo.png"
    # 都没关键字时，根目录的胜出（assets/ 里多是图集素材）
    assert covers._hf_pick(["assets/only.png", "photo.png"]) == "photo.png"


def test_modelscope_url_gets_oss_resize():
    """魔搭原图 2.5 MB，加 OSS 缩放后 145 KB；不改这里等于每张卡都拉原图。"""
    url = "https://resources.modelscope.cn/cover-images/abc.png"
    assert covers._sized(url) == url + "?x-oss-process=image/resize,w_640/format,jpg"
    already = url + "?x-oss-process=image/resize,w_320"
    assert covers._sized(already) == already
    assert covers._sized("https://example.com/a.png") == "https://example.com/a.png"
