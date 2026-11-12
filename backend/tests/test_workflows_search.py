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
