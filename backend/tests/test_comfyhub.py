"""ComfyHub 源：索引字段映射、检索分页、下载直链。

索引是「一次给全量」的列表，不是搜索接口；下载走站点公开的 shareId 路由。
这些用例锁住两件容易错的事：非 approved 不能混进发现页，以及下载文件名
本身不含 workflow/comfy 字样时也不能被通用文件过滤规则丢掉。
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import workflows
from app.sources import get_adapter
from app.sources.base import SourceError


@pytest.fixture(autouse=True)
def _restore_cache():
    snapshot = dict(workflows._HUB_CACHE)
    yield
    workflows._HUB_CACHE.clear()
    workflows._HUB_CACHE.update(snapshot)


def _resp(payload, status=200):
    return SimpleNamespace(status_code=status, json=lambda: payload)


def _head(size=6064, status=200):
    return SimpleNamespace(status_code=status, headers={"content-length": str(size)})


HUB_ROWS = [
    {
        "shareId": "1d940575328b",
        "title": "Qwen Image 2.1 Turbo: Image edit",
        "description": "Edit images with Qwen-Image-2.1",
        "status": "approved",
        "date": "2026-10-28",
        "usage": 3308,
        "tags": ["Image Edit", "Qwen"],
        "models": ["Qwen-Image"],
        "thumbnailUrl": "https://comfy-hub-assets.comfy.org/uploads/demo.png",
        "profile": {"display_name": "ComfyUI", "username": "comfyui"},
    },
    {
        "shareId": "0f5f5bc82df5",
        "title": "FLUX 3 Image Klein: Image Edit",
        "description": "Edit an existing image with FLUX 3",
        "status": "approved",
        "date": "2026-09-02",
        "usage": 942,
        "tags": ["Image Edit"],
        "models": ["Flux", "FLUX.1"],
        "thumbnailUrl": "",
        "profile": {},
    },
    {
        "shareId": "deadbeefcafe",
        "title": "待审核的一条",
        "status": "pending",
        "usage": 99999,
        "profile": {},
    },
]


def test_index_maps_fields_and_skips_unapproved(monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return _resp(HUB_ROWS)

    monkeypatch.setattr(workflows.httpx, "get", fake_get)
    workflows._HUB_CACHE.update(at=0.0, items=[])
    items = workflows._hub_index()

    assert len(items) == 2  # pending 那条不能出现在发现页
    first = items[0]
    assert first["source"] == "comfyhub"
    assert first["id"] == "1d940575328b"
    assert first["name"] == "Qwen Image 2.1 Turbo: Image edit"
    assert first["author"] == "ComfyUI"
    assert first["downloads"] == 3308
    assert first["updated_at"] == "2026-10-28"
    assert first["files"] == ["1d940575328b.json"]
    assert first["thumbnail"].endswith("demo.png")
    assert "/cdn-cgi/image/width=448" in first["thumbnail"]  # 不铺 1MB 原图
    assert first["requires"] == ["模型:Qwen-Image"]
    assert first["url"] == "https://comfy.org/workflows/1d940575328b"
    assert items[1]["author"] == "ComfyHub"  # 没 profile 时别留空

    workflows._hub_index()
    assert len(calls) == 1  # 3.7MB 索引不能每次搜索都重拉


def test_index_drops_video_thumbnail(monkeypatch):
    row = dict(HUB_ROWS[0])
    row["thumbnailUrl"] = "https://comfy-hub-assets.comfy.org/templates/x.mp4"
    monkeypatch.setattr(workflows.httpx, "get", lambda *a, **k: _resp([row]))
    workflows._HUB_CACHE.update(at=0.0, items=[])
    assert workflows._hub_index()[0]["thumbnail"] == ""


def test_thumb_handles_both_paths_and_rejects_video_audio():
    base = "https://comfy-hub-assets.comfy.org/"
    assert "/cdn-cgi/image/width=448" in workflows._hub_thumb(base + "uploads/a.png")
    assert "/cdn-cgi/image/width=448" in workflows._hub_thumb(base + "templates/b.webp")
    # 视频/音频封面走缩图服务会 415，卡片宁可直接画铭牌
    assert workflows._hub_thumb(base + "templates/c.mp4") == ""
    assert workflows._hub_thumb(base + "uploads/d.mp3") == ""
    assert workflows._hub_thumb(base + "templates/e.json") == ""
    assert workflows._hub_thumb("https://evil.example/x.png") == ""
    assert workflows._hub_thumb("") == ""


def test_index_error_is_a_source_error(monkeypatch):
    monkeypatch.setattr(workflows.httpx, "get", lambda *a, **k: _resp({}, status=503))
    workflows._HUB_CACHE.update(at=0.0, items=[])
    with pytest.raises(SourceError, match="503"):
        workflows._hub_index()


def test_search_filters_sorts_and_paginates(monkeypatch):
    entries = []
    for i in range(5):
        entries.append(
            {
                "id": f"id{i}",
                "name": f"Flux Edit {i}",
                "description": "",
                "tags": ["Image Edit"],
                "categories": [],
                "requires": [],
                "downloads": 100 - i * 10,
                "updated_at": f"2026-10-{20 - i:02d}",
                "source": "comfyhub",
            }
        )
    entries.append(
        {
            "id": "other",
            "name": "Wan Video",
            "description": "",
            "tags": [],
            "categories": [],
            "requires": [],
            "downloads": 9999,
            "updated_at": "2026-10-30",
            "source": "comfyhub",
        }
    )
    monkeypatch.setattr(workflows, "_hub_index", lambda: entries)

    page1, more = workflows._search_comfyhub("flux", 2, 1)
    assert [x["id"] for x in page1] == ["id0", "id1"]
    assert more is True
    page3, more3 = workflows._search_comfyhub("flux", 2, 3)
    assert [x["id"] for x in page3] == ["id4"]
    assert more3 is False
    assert [x["id"] for x in workflows._search_comfyhub("", 2, 1, "latest")[0]] == ["other", "id0"]
    assert workflows._search_comfyhub("不存在的模型", 2, 1)[0] == []


def test_adapter_resolves_public_download_url(monkeypatch):
    seen = {}

    def fake_head(url, **kwargs):
        seen["url"] = url
        return _head(6064)

    monkeypatch.setattr("app.sources.comfyhub.httpx.head", fake_head)
    repo = get_adapter("comfyhub").resolve("1d940575328b", "", {})
    assert seen["url"] == "https://comfy.org/workflows/download/1d940575328b.json"
    assert repo.display_name == "ComfyHub"  # 全站收进一个目录，不按条建 800 个文件夹
    assert repo.files[0].path == "1d940575328b.json"
    assert repo.files[0].size == 6064
    assert repo.files[0].candidates == [seen["url"]]


def test_adapter_falls_back_to_get_for_chunked_response(monkeypatch):
    """站点 HEAD 不给 content-length；不补 GET 就会写成 0 字节任务。"""
    monkeypatch.setattr(
        "app.sources.comfyhub.httpx.head",
        lambda *a, **k: SimpleNamespace(status_code=200, headers={}),
    )
    monkeypatch.setattr(
        "app.sources.comfyhub.httpx.get",
        lambda *a, **k: SimpleNamespace(status_code=200, content=b'{"nodes":[]}'),
    )
    repo = get_adapter("comfyhub").resolve("1d940575328b", "", {})
    assert repo.files[0].size == len(b'{"nodes":[]}')


def test_adapter_rejects_invalid_share_id():
    with pytest.raises(SourceError, match="无效"):
        get_adapter("comfyhub").resolve("https://evil.example/x.json", "", {})


def test_resolve_keeps_hash_named_file(monkeypatch):
    """文件名是 shareId，不含 workflow/comfy 字样，不能走通用过滤被丢掉。"""
    monkeypatch.setattr("app.sources.comfyhub.httpx.head", lambda *a, **k: _head(100))
    payload = workflows.resolve("comfyhub", "1d940575328b")
    assert [f["path"] for f in payload["files"]] == ["1d940575328b.json"]
    assert payload["target_folder"] == "workflows"


# ---------------- 索引落盘兜底 ----------------

def test_index_reads_disk_without_hitting_network(monkeypatch, tmp_path):
    """内存空、盘上有：直接返回盘上索引，不发网络请求。

    这是「后端每重启一次，首屏就白等 10 秒」的修法：827 条索引落过盘，
    重启后先拿旧的顶上，后台再换新的。
    """
    import json

    path = tmp_path / "comfyhub-index.json"
    path.write_text(
        json.dumps({"at": 0, "items": [{"id": "disk-1", "source": "comfyhub"}]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(workflows, "_HUB_CACHE", {"at": 0.0, "items": []})
    monkeypatch.setattr(workflows, "_HUB_CACHE_FILE", path)

    def boom(*a, **k):
        raise AssertionError("不该打网络：盘上已有索引")

    monkeypatch.setattr(workflows.httpx, "get", boom)
    monkeypatch.setattr(workflows, "_refresh_index_in_background", lambda *a, **k: None)

    items = workflows._hub_index()
    assert [i["id"] for i in items] == ["disk-1"]


def test_index_fetches_and_persists_when_disk_empty(monkeypatch, tmp_path):
    """盘上也没有（第一次跑）：同步拉一次，并落盘供下次启动用。"""
    import json

    path = tmp_path / "comfyhub-index.json"
    monkeypatch.setattr(workflows, "_HUB_CACHE", {"at": 0.0, "items": []})
    monkeypatch.setattr(workflows, "_HUB_CACHE_FILE", path)

    payload = [{"shareId": "abc123", "title": "Fresh", "status": "approved"}]
    monkeypatch.setattr(
        workflows.httpx,
        "get",
        lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: payload),
    )

    items = workflows._hub_index()
    assert [i["id"] for i in items] == ["abc123"]
    assert path.exists(), "拉到的索引必须落盘，否则下次重启还要再等一遍"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert [i["id"] for i in saved["items"]] == ["abc123"]


def test_corrupt_disk_index_falls_back_to_network(monkeypatch, tmp_path):
    """盘上的缓存坏了不能把发现页弄挂，退回网络拉取。"""
    path = tmp_path / "comfyhub-index.json"
    path.write_text("{ 这不是 JSON", encoding="utf-8")
    monkeypatch.setattr(workflows, "_HUB_CACHE", {"at": 0.0, "items": []})
    monkeypatch.setattr(workflows, "_HUB_CACHE_FILE", path)

    payload = [{"shareId": "ok1", "title": "Ok", "status": "approved"}]
    monkeypatch.setattr(
        workflows.httpx,
        "get",
        lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: payload),
    )

    items = workflows._hub_index()
    assert [i["id"] for i in items] == ["ok1"]
