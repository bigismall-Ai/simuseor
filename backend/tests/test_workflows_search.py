"""工作流发现的关键词匹配、模板排序与多源合并。

这几个用例锁的都是「官方模板搜不到」的具体成因：
1. 查询带空格（`h3 image edit`）必须能命中 `image_minimax_h3_image_edit`；
2. 刚发布的模板 usage 是 0，不能因此被沉到 760 条的最后；
3. 全部来源按源轮询合并，官方模板不能被 HF 的几十万下载挤到 limit 之外。
"""
from __future__ import annotations

import time

from app import workflows


def _template(name: str, title: str, *, usage: int = 0, date: str = "2026-11-10", tags=None) -> dict:
    return {
        "id": name,
        "name": title,
        "author": "ComfyUI",
        "source": "templates",
        "description": "",
        "downloads": usage,
        "likes": 0,
        "tags": tags or [],
        "task": "Workflows",
        "url": f"https://example.invalid/{name}.json",
        "updated_at": date,
        "files": [f"{name}.json"],
        "file_count": 1,
        "target_folder": "workflows",
        "thumbnail": "",
        "requires": [],
        "categories": ["Image", "Foundation"],
    }


def _today(offset_days: int = 0) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(time.time() - offset_days * 86400))


# ---------------- 匹配 ----------------

def test_tokens_split_on_underscore_and_space():
    tokens = workflows._query_tokens("  MiniMax_h3-image EDit ")
    assert tokens == ["minimax", "h3", "image", "edit"]


def test_space_query_hits_underscore_id_and_title():
    item = _template("image_minimax_h3_image_edit", "MiniMax-H3-Image: Image Edit")
    # 旧实现拿整串做子串匹配，带空格的查询必然 0 命中
    assert workflows._relevance(item, workflows._query_tokens("h3 image edit")) > 0
    assert workflows._relevance(item, workflows._query_tokens("minimax h3 image edit")) > 0


def test_relevance_rejects_partial_match():
    item = _template("image_qwen_edit", "Qwen Image Edit")
    assert workflows._relevance(item, workflows._query_tokens("minimax")) == -1


def test_title_match_scores_higher_than_description():
    titled = _template("a", "MiniMax H3: Image Edit")
    described = _template("b", "Something else")
    described["description"] = "Uses MiniMax H3 for editing"
    tokens = workflows._query_tokens("minimax")
    assert workflows._relevance(titled, tokens) > workflows._relevance(described, tokens)


# ---------------- 排序 ----------------

def test_new_template_gets_freshness_boost():
    """刚发布的模板 usage=0，热度分要高于同为零但已发布很久的条目。"""
    fresh = _template("fresh", "Fresh", usage=0, date=_today(1))
    stale = _template("stale", "Stale", usage=0, date=_today(120))
    assert workflows._hot_score(fresh) > workflows._hot_score(stale)
    assert workflows._hot_score(fresh) > 0


def test_hot_score_keeps_popular_template_on_top():
    now = time.time()
    popular = _template("popular", "Popular", usage=9000, date=_today(120))
    fresh = _template("fresh", "Fresh", usage=0, date=_today(0))
    assert workflows._hot_score(popular, now) > workflows._hot_score(fresh, now)


def test_search_templates_ranks_fresh_match_within_first_page(monkeypatch):
    items = [
        _template("video_minimax_h3_t2v", "MiniMax H3: Text to Video", usage=4400, date=_today(90)),
        _template("image_minimax_h3_image_edit", "MiniMax-H3-Image: Image Edit", usage=0, date=_today(2)),
        _template("image_minimax_h3_image_t2i", "MiniMax-H3-Image: Text to Image", usage=0, date=_today(2)),
        _template("old_low", "MiniMax Old", usage=60, date=_today(200)),
    ]
    monkeypatch.setattr(workflows, "_templates", lambda: items)
    page, has_more = workflows._search_templates("minimax", 12, 1, "downloads")
    ids = [it["id"] for it in page]
    assert ids[0] == "video_minimax_h3_t2v"
    # 新模板只能进前几，不能因为 usage=0 掉出第一页
    assert "image_minimax_h3_image_edit" in ids
    assert ids.index("image_minimax_h3_image_edit") < ids.index("old_low")
    assert has_more is False


def test_search_templates_latest_is_pure_date_order(monkeypatch):
    items = [
        _template("hot_old", "MiniMax H3 Old", usage=9000, date=_today(120)),
        _template("fresh_one", "MiniMax H3 Fresh", usage=0, date=_today(1)),
    ]
    monkeypatch.setattr(workflows, "_templates", lambda: items)
    page, _ = workflows._search_templates("minimax", 12, 1, "latest")
    assert [it["id"] for it in page] == ["fresh_one", "hot_old"]


# ---------------- 多源合并 ----------------

def test_interleave_keeps_every_source_on_first_screen():
    a = [{"source": "templates", "id": f"t{i}"} for i in range(3)]
    b = [{"source": "huggingface", "id": f"h{i}"} for i in range(3)]
    merged = workflows._interleave([a, b])
    assert [it["source"] for it in merged] == ["templates", "huggingface"] * 3


def test_search_all_does_not_bury_templates(monkeypatch):
    """旧实现按下载量全局排序，HF 的几十万下载会把官方模板挤出第一屏。"""
    templates = [{"source": "templates", "id": "image_minimax_h3_image_edit", "downloads": 0}]
    heavy = [
        {"source": "huggingface", "id": f"repo{i}", "downloads": 400_000 - i} for i in range(12)
    ]

    def fake_templates(q, limit, page, sort="downloads"):
        return templates, False

    def fake_huggingface(q, limit, page, sort="downloads"):
        return heavy, False

    # 整表替换：留下真源会真打外网（GitHub 无 token 直接 401）
    monkeypatch.setattr(
        workflows, "_SEARCHERS", {"templates": fake_templates, "huggingface": fake_huggingface}
    )

    result = workflows.search("minimax", "all", 12, 1, "downloads")
    assert result["items"][0]["source"] == "templates"
    assert result["errors"] == {}


def test_search_single_source_keeps_its_order(monkeypatch):
    def fake(q, limit, page, sort="downloads"):
        return [{"source": "templates", "id": "a"}, {"source": "templates", "id": "b"}], False

    monkeypatch.setattr(workflows, "_SEARCHERS", {"templates": fake})
    result = workflows.search("", "templates", 12, 1, "downloads")
    assert [it["id"] for it in result["items"]] == ["a", "b"]


# ---------------- Civitai 游标翻页 ----------------

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


def _civitai_model(mid: int, name: str) -> dict:
    return {
        "id": mid,
        "name": name,
        "creator": {"username": "someone"},
        "modelVersions": [{"files": [{"name": "wf.json"}], "images": []}],
        "stats": {},
        "tags": [],
    }


def _civitai_fixture(monkeypatch):
    """按 cursor 返回分页数据，并记录每次请求的参数。"""
    pages = {
        "": (_civitai_model(1, "第一页"), "c2", True),
        "c2": (_civitai_model(2, "第二页"), "c3", True),
        "c3": (_civitai_model(3, "第三页"), "", False),
    }
    calls: list[dict] = []

    def fake_get(url, *, params, headers, timeout, follow_redirects, proxy=None):
        calls.append(dict(params))
        cursor = params.get("cursor") or ""
        model, nxt, _ = pages[cursor]
        metadata = {"nextCursor": nxt} if nxt else {}
        return _FakeResp({"items": [model], "metadata": metadata})

    monkeypatch.setattr(workflows.httpx, "get", fake_get)
    monkeypatch.setattr(workflows, "_source_cfg", lambda name: {})
    workflows._CIVITAI_CURSORS.clear()
    return calls


def test_civitai_pagination_follows_next_cursor(monkeypatch):
    """旧实现 page>1 直接返回空：Civitai 工作流永远只有第一页。"""
    calls = _civitai_fixture(monkeypatch)
    first, more1 = workflows._search_civitai("flux", 12, 1)
    second, more2 = workflows._search_civitai("flux", 12, 2)

    assert [it["id"] for it in first] == ["1"]
    assert [it["id"] for it in second] == ["2"]
    assert more1 and more2
    assert "page" not in calls[0]                 # page 参数已被证实无效，不能再用
    assert calls[0].get("cursor") is None
    assert calls[1].get("cursor") == "c2"
    assert len(calls) == 2                       # 顺序翻页不重抓第一页


def test_civitai_has_more_comes_from_cursor_not_item_count(monkeypatch):
    """条目被 files 为空过滤掉时，len(items)>=limit 会把还有下一页误判成到底。"""
    calls = _civitai_fixture(monkeypatch)
    workflows._search_civitai("", 12, 1)
    last, more = workflows._search_civitai("", 12, 3)
    assert [it["id"] for it in last] == ["3"]
    assert more is False
    assert calls[2].get("cursor") == "c3"


def test_civitai_page_jump_rebuilds_cursor_chain(monkeypatch):
    """缓存冷启动直接要第 3 页时，顺着 nextCursor 补齐，不重复返回旧条目。"""
    calls = _civitai_fixture(monkeypatch)
    third, more = workflows._search_civitai("flux", 12, 3)
    assert [it["id"] for it in third] == ["3"]
    assert more is False
    assert [c.get("cursor") for c in calls] == [None, "c2", "c3"]


# ---------------- 聚合搜索的缓存 ----------------

def _counting_searcher(payload, *, fail=False):
    """记录被调用了几次 —— 缓存命中的判据就是「源没被再打一次」。"""
    calls = {"n": 0}

    def fake(q, limit, page, sort="downloads"):
        calls["n"] += 1
        if fail:
            from app.sources.base import SourceError

            raise SourceError("boom")
        return payload, False

    return fake, calls


def test_search_is_cached(monkeypatch):
    """同一组参数第二次不该再打源。

    发现页每次翻页、改筛选、从别处返回都会重新请求；六个源里有四个
    （Civitai / HF / ModelScope / GitHub）没有索引缓存，每次都真打网络，
    不缓存的话一次翻页要等好几秒。
    """
    fake, calls = _counting_searcher([{"source": "templates", "id": "a"}])
    monkeypatch.setattr(workflows, "_SEARCHERS", {"templates": fake})

    first = workflows.search("flux", "all", 12, 1, "downloads")
    second = workflows.search("flux", "all", 12, 1, "downloads")

    assert calls["n"] == 1, "第二次应命中缓存，不该再打源"
    assert first == second


def test_search_cache_key_normalizes_case(monkeypatch):
    """搜 "Flux" 和 "flux" 是同一批结果，不该占两份缓存。"""
    fake, calls = _counting_searcher([{"source": "templates", "id": "a"}])
    monkeypatch.setattr(workflows, "_SEARCHERS", {"templates": fake})

    workflows.search("Flux", "all", 12, 1, "downloads")
    workflows.search("flux", "all", 12, 1, "downloads")
    assert calls["n"] == 1


def test_search_cache_separates_params(monkeypatch):
    """不同分页/排序必须各自缓存，不能拿 page=1 的结果冒充 page=2。"""
    fake, calls = _counting_searcher([{"source": "templates", "id": "a"}])
    monkeypatch.setattr(workflows, "_SEARCHERS", {"templates": fake})

    workflows.search("", "all", 12, 1, "downloads")
    workflows.search("", "all", 12, 2, "downloads")
    workflows.search("", "all", 12, 1, "latest")
    assert calls["n"] == 3, "三种不同参数应各打一次"


def test_search_does_not_cache_total_failure(monkeypatch):
    """全部源都失败时不缓存。

    否则一断网就锁死 20 分钟，网络恢复后还要等缓存过期才有内容 ——
    用户会以为「再也刷不出来了」。
    """
    fake, calls = _counting_searcher([], fail=True)
    monkeypatch.setattr(workflows, "_SEARCHERS", {"templates": fake})

    first = workflows.search("flux", "all", 12, 1, "downloads")
    assert first["errors"]
    assert first["items"] == []

    workflows.search("flux", "all", 12, 1, "downloads")
    assert calls["n"] == 2, "失败结果不该被缓存"


def test_search_caches_partial_success(monkeypatch):
    """部分源失败但拿到了内容时仍然缓存 —— 有东西看就别让人重等。"""
    ok, ok_calls = _counting_searcher([{"source": "templates", "id": "a"}])
    bad, bad_calls = _counting_searcher([], fail=True)
    monkeypatch.setattr(workflows, "_SEARCHERS", {"templates": ok, "huggingface": bad})

    workflows.search("flux", "all", 12, 1, "downloads")
    result = workflows.search("flux", "all", 12, 1, "downloads")

    assert result["items"], "应返回部分成功的内容"
    assert ok_calls["n"] == 1
    assert bad_calls["n"] == 1


def test_clear_search_drops_workflow_cache(monkeypatch):
    """设置变更（token / 代理）要连工作流缓存一起清。

    GitHub token 配没配决定「全部来源」是否包含 GitHub；token 刚填好
    却还命中旧缓存的话，用户会以为没生效。
    """
    from app import cache

    fake, calls = _counting_searcher([{"source": "templates", "id": "a"}])
    monkeypatch.setattr(workflows, "_SEARCHERS", {"templates": fake})

    workflows.search("flux", "all", 12, 1, "downloads")
    cache.clear_search()
    workflows.search("flux", "all", 12, 1, "downloads")
    assert calls["n"] == 2
