"""本地热力榜：命中判断、落盘、失败保留旧数据。

这几个用例锁的是「榜不能骗人」的四条底线：
1. 只有首屏默认参数才命中，搜索词/换排序不许被旧数据顶掉
2. 抓取时某个源偶发失败，错误不能固化进用户看到的 payload
3. 刷新失败必须保留上一份，不能把页面刷空
4. 进程重启后从磁盘读得到（这是它存在的全部理由）
"""
from __future__ import annotations

import json

import pytest

from app import hot_board


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(hot_board, "HOT_DIR", tmp_path / "hot")
    monkeypatch.setattr(hot_board, "_BOARDS", {})
    monkeypatch.setattr(hot_board, "_MEM", {})
    monkeypatch.setattr(hot_board, "_REFRESHING", set())
    monkeypatch.setattr(hot_board, "_BUILDING", set())


def test_matches_only_default_params():
    hot_board.register("t", 60, {"q": "", "sort": "hot", "limit": 20}, lambda: {"items": []})

    assert hot_board.matches("t", q="", sort="hot", limit=20)
    assert hot_board.matches("t", q="", sort="hot", limit="20"), "前端把 limit 传成字符串也要认"

    assert not hot_board.matches("t", q="flux", sort="hot", limit=20), "有搜索词必须走实时"
    assert not hot_board.matches("t", q="", sort="latest", limit=20), "换排序必须走实时"
    assert not hot_board.matches("unknown", q=""), "没登记的榜不许命中"


def test_refresh_strips_errors_from_payload():
    hot_board.register(
        "t",
        60,
        {"q": ""},
        lambda: {"items": [1], "total": 1, "errors": {"github": "响应超时"}},
    )

    assert hot_board.refresh("t")
    assert hot_board.get("t") == {"items": [1], "total": 1}, "errors 不能出现在用户拿到的 payload 里"

    raw = json.loads((hot_board.HOT_DIR / "t.json").read_text(encoding="utf-8"))
    assert raw["meta"]["errors"] == {"github": "响应超时"}, "错误要留在 meta 里供诊断"


def test_refresh_failure_keeps_previous_data():
    calls = {"n": 0}

    def build():
        calls["n"] += 1
        if calls["n"] == 1:
            return {"items": [1]}
        raise RuntimeError("网络挂了")

    hot_board.register("t", 60, {"q": ""}, build)

    assert hot_board.refresh("t")
    assert hot_board.refresh("t") is False
    assert hot_board.get("t") == {"items": [1]}, "刷新失败必须保留上一份，不能把首屏刷空"


def test_get_reads_disk_after_restart():
    hot_board.register("t", 60, {"q": ""}, lambda: {"items": [7]})
    assert hot_board.refresh("t")

    hot_board._MEM.clear()  # 模拟进程重启：内存没了，只剩磁盘
    assert hot_board.get("t") == {"items": [7]}


def test_no_self_hit_while_building():
    """build() 内部会回调同一个路由函数，此时不能再命中自己。

    不拦的话，刷新拿到的是「旧数据」，然后被当成新数据写回去 —— 刷新等于没刷。
    """

    def build():
        assert hot_board.matches("t", q="") is False, "构建中不该命中自己"
        return {"items": [2]}

    hot_board.register("t", 60, {"q": ""}, build)
    assert hot_board.refresh("t")
    assert hot_board.get("t") == {"items": [2]}


def test_corrupt_file_is_ignored(tmp_path):
    hot_board.register("t", 60, {"q": ""}, lambda: {"items": [1]})
    hot_board.HOT_DIR.mkdir(parents=True, exist_ok=True)
    (hot_board.HOT_DIR / "t.json").write_text("{ 坏掉的 json", encoding="utf-8")

    assert hot_board.get("t") is None, "坏缓存当作没有，不能把发现页弄挂"
