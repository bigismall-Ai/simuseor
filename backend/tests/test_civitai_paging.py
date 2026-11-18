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



# ---------------- API 固定走 civitai.red，不提供配置 ----------------
#
# civitai.com 在国内被 DNS 注入（轮换假 IP）+ SNI 阻断，直连 21 秒超时；
# .red 解析到真实 Cloudflare IP，1.4~1.9 秒。两者 /api/v1 实测同一后端
# （5 组查询逐条 id 一致），所以只挑能连上的那条，不给用户一个没意义的选择。

def test_search_always_hits_red(monkeypatch):
    seen = {}

    def fake_get(url, **kw):
        seen["url"] = url
        seen.update(kw)
        return httpx.Response(200, json={"items": [], "metadata": {}})

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    cv.CivitaiAdapter().search("", 6, 1, "downloads", {})

    assert seen["url"].startswith("https://civitai.red/api/v1/models")


def test_search_proxy_follows_source_switch(monkeypatch):
    """通路固定 .red，但「要不要再过代理」仍归每源开关管。"""
    seen = {}

    def fake_get(url, **kw):
        seen.update(kw)
        return httpx.Response(200, json={"items": [], "metadata": {}})

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    # 假实现必须尊重开关，否则「关掉代理」那条断言恒假
    monkeypatch.setattr(
        cv, "source_proxy", lambda cfg: "http://127.0.0.1:7890" if (cfg or {}).get("proxy_enabled") else None
    )

    cv.CivitaiAdapter().search("", 6, 1, "downloads", {"proxy_enabled": True})
    assert seen.get("proxy") == "http://127.0.0.1:7890"

    # 用 page=1：只有第 1 页一定会发请求，第 2 页在游标为空时直接返回空页
    cv.CivitaiAdapter().search("", 6, 1, "downloads", {"proxy_enabled": False})
    assert seen.get("proxy") is None
