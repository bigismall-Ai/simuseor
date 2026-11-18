"""Civitai 翻页：只能靠 cursor，`page` 参数已失效。

2026-11 实测：`/api/v1/models?page=1|2|3` 返回同一批模型（id 完全一致），
翻页必须跟随 `metadata.nextPage` 里的 cursor。此前只有关键词搜索走游标，
分类浏览仍在传 page —— 表现就是「翻到下一页还是这一页」。
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.sources import civitai as cv

PAGE1 = [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}]
PAGE2 = [{"id": 3, "name": "C"}, {"id": 4, "name": "D"}]
PAGE3 = [{"id": 5, "name": "E"}]


def _resp(items: list[dict], next_cursor: str | None) -> httpx.Response:
    meta = {"nextPage": f"https://civitai.com/api/v1/models?limit=2&cursor={next_cursor}"} if next_cursor else {}
    return httpx.Response(
        status_code=200,
        content=json.dumps({"items": items, "metadata": meta}).encode(),
        request=httpx.Request("GET", "https://civitai.com/api/v1/models"),
    )


def test_list_pages_follow_cursor(monkeypatch):
    seen: list[dict] = []

    def fake_get(url, **kwargs):
        params = dict(kwargs.get("params") or {})
        seen.append(params)
        cursor = params.get("cursor")
        if not cursor:
            return _resp(PAGE1, "c1")
        if cursor == "c1":
            return _resp(PAGE2, "c2")
        return _resp(PAGE3, None)

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    adapter = cv.CivitaiAdapter()
    cfg = {"proxy_enabled": False}

    first = [m["id"] for m in adapter.search("", 2, 1, "", cfg)["items"]]
    second = [m["id"] for m in adapter.search("", 2, 2, "", cfg)["items"]]
    third = [m["id"] for m in adapter.search("", 2, 3, "", cfg)["items"]]

    assert first == ["1", "2"]
    assert second == ["3", "4"]
    assert third == ["5"]
    assert len(set(first + second + third)) == 5  # 没有任何一页重复
    # 任何一页都不该再发 page 参数（发了也会被服务端忽略，属于假分页）
    assert all("page" not in p for p in seen)
    assert seen[-1].get("cursor") == "c2"


def test_keyword_search_also_uses_cursor(monkeypatch):
    seen: list[dict] = []

    def fake_get(url, **kwargs):
        params = dict(kwargs.get("params") or {})
        seen.append(params)
        return _resp(PAGE1, "c1") if "cursor" not in params else _resp(PAGE2, None)

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    adapter = cv.CivitaiAdapter()
    cfg = {"proxy_enabled": False}

    adapter.search("portrait", 2, 1, "", cfg)
    adapter.search("portrait", 2, 2, "", cfg)

    assert seen[0]["query"] == "portrait"
    assert "cursor" not in seen[0]
    assert seen[1]["cursor"] == "c1"


def test_cursor_cache_is_per_query(monkeypatch):
    """不同关键词各自维护游标链，不能互相顶掉。"""
    seen: list[dict] = []

    def fake_get(url, **kwargs):
        params = dict(kwargs.get("params") or {})
        seen.append(params)
        q = params.get("query")
        return _resp(PAGE1, f"{q}-c1") if "cursor" not in params else _resp(PAGE2, None)

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    adapter = cv.CivitaiAdapter()
    cfg = {"proxy_enabled": False}

    adapter.search("cat", 2, 1, "", cfg)
    adapter.search("dog", 2, 1, "", cfg)
    adapter.search("cat", 2, 2, "", cfg)

    assert seen[-1]["cursor"] == "cat-c1"
    assert seen[-1]["query"] == "cat"


# ---------------- API 域名是「通路」，不是「可见性」 ----------------
#
# civitai.com 与 civitai.red 在产品上是**并列的两条线**（面向不同可见性），不是主备，
# 所以这里不做失败降级。但两者 /api/v1 实测是同一后端（5 种查询逐条 id 一致），
# 于是「走哪个域名」退化成纯网络问题 —— 单独给一个开关，别塞进 full_catalog 分支。

def test_api_base_defaults_to_official():
    assert cv.api_base({}) == cv.OFFICIAL_API
    assert cv.api_base(None) == cv.OFFICIAL_API
    # 填了但没启用：不该生效，否则「填一下试试」就悄悄换了通路
    assert cv.api_base({"mirror": "https://civitai.red"}) == cv.OFFICIAL_API
    assert cv.api_base({"use_mirror": True, "mirror": ""}) == cv.OFFICIAL_API


def test_api_base_normalizes_host_and_full_path():
    assert cv.api_base({"use_mirror": True, "mirror": "https://civitai.red"}) == (
        "https://civitai.red/api/v1"
    )
    # 尾斜杠 / 已经带路径，都不该拼成 /api/v1/api/v1
    assert cv.api_base({"use_mirror": True, "mirror": "https://civitai.red/"}) == (
        "https://civitai.red/api/v1"
    )
    assert cv.api_base({"use_mirror": True, "mirror": "https://civitai.red/api/v1"}) == (
        "https://civitai.red/api/v1"
    )


def test_search_uses_mirror_without_proxy(monkeypatch):
    """走镜像时不能再套代理：镜像是另一条通路，经代理等于绕回原路。"""
    seen = {}

    def fake_get(url, **kw):
        seen["url"] = url
        seen.update(kw)
        return httpx.Response(200, json={"items": [], "metadata": {}})

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    monkeypatch.setattr(cv, "source_proxy", lambda cfg: "http://127.0.0.1:7890")

    cv.CivitaiAdapter().search(
        "", 6, 1, "downloads", {"use_mirror": True, "mirror": "https://civitai.red"}
    )

    assert seen["url"].startswith("https://civitai.red/api/v1/models")
    assert seen.get("proxy") is None, "镜像通路不该再经代理"


def test_search_keeps_proxy_on_official(monkeypatch):
    seen = {}

    def fake_get(url, **kw):
        seen["url"] = url
        seen.update(kw)
        return httpx.Response(200, json={"items": [], "metadata": {}})

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    monkeypatch.setattr(cv, "source_proxy", lambda cfg: "http://127.0.0.1:7890")

    cv.CivitaiAdapter().search("", 6, 1, "downloads", {"proxy_enabled": True})

    assert seen["url"].startswith("https://civitai.com/api/v1/models")
    assert seen.get("proxy") == "http://127.0.0.1:7890"
