"""HF 搜索分页：/api/models 不认 page，只能跟随 Link 头的 cursor。

2026-11 实测：`limit=5&page=1/2` 返回同一批 5 条；真正的下一页在
`Link: <...&cursor=...>; rel="next"` 里。前端点「加载更多」只会把同一页
重复追加，看起来像「只能加载两页」。
"""
from __future__ import annotations

import httpx

from app.sources import huggingface as hf


def _resp(headers: dict | None = None, body: bytes = b"[]") -> httpx.Response:
    return httpx.Response(
        status_code=200,
        headers=headers or {},
        content=body,
        request=httpx.Request("GET", "https://huggingface.co/api/models"),
    )


def test_next_cursor_reads_link_header():
    resp = _resp(
        {"link": '<https://huggingface.co/api/models?limit=20&cursor=abc%2Fdef>; rel="next"'}
    )
    assert hf.HuggingFaceAdapter._next_cursor(resp) == "abc/def"


def test_next_cursor_none_without_link():
    assert hf.HuggingFaceAdapter._next_cursor(_resp()) is None


def test_fetch_query_page_follows_cursors(monkeypatch):
    adapter = hf.HuggingFaceAdapter()
    calls: list[str | None] = []
    pages = {
        None: ([{"id": f"p1-{i}"} for i in range(3)], "C1"),
        "C1": ([{"id": f"p2-{i}"} for i in range(3)], "C2"),
        "C2": ([{"id": f"p3-{i}"} for i in range(3)], None),
    }

    def fake_fetch(api_base, params, headers, proxy):
        cur = params.get("cursor")
        calls.append(cur)
        return pages[cur]

    monkeypatch.setattr(adapter, "_fetch", fake_fetch)

    p1 = adapter._fetch_query_page("https://x", {"limit": 3}, {}, None, 1)
    p2 = adapter._fetch_query_page("https://x", {"limit": 3}, {}, None, 2)
    p3 = adapter._fetch_query_page("https://x", {"limit": 3}, {}, None, 3)
    beyond = adapter._fetch_query_page("https://x", {"limit": 3}, {}, None, 4)

    assert [x["id"] for x in p1] == ["p1-0", "p1-1", "p1-2"]
    assert [x["id"] for x in p2] == ["p2-0", "p2-1", "p2-2"]
    assert [x["id"] for x in p3] == ["p3-0", "p3-1", "p3-2"]
    assert beyond == []
    # 第一页不带 cursor，第二页用 C1，第三页用 C2；越过末页不再请求
    assert calls == [None, "C1", "C2"]


def test_fetch_query_page_rebuilds_cursor_after_restart(monkeypatch):
    """后端缓存命中 page1 时，适配器游标缓存可能是空的 —— 要能补回 page2。"""
    adapter = hf.HuggingFaceAdapter()
    calls: list[str | None] = []
    pages = {
        None: ([{"id": "a"}], "C1"),
        "C1": ([{"id": "b"}], "C2"),
    }

    def fake_fetch(api_base, params, headers, proxy):
        cur = params.get("cursor")
        calls.append(cur)
        return pages[cur]

    monkeypatch.setattr(adapter, "_fetch", fake_fetch)

    p2 = adapter._fetch_query_page("https://x", {"limit": 1}, {}, None, 2)

    assert [x["id"] for x in p2] == ["b"]
    assert calls == [None, "C1"]
