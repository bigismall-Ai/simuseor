"""pytest 引导：把 backend 目录加入 sys.path，使 tests 能 import app.*。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture(autouse=True)
def _clear_search_caches():
    """每个测试前后清空搜索缓存。

    搜索缓存是**进程级单例**，不隔离就会跨测试污染：
    A 测试用 fake 源搜 "minimax"，B 测试搜同样的词会直接命中 A 的 fake 结果，
    测试之间产生看不见的依赖 —— 单独跑全过、一起跑随机挂，或者反过来。
    """
    from app import cache

    cache.clear_search()
    yield
    cache.clear_search()


@pytest.fixture(autouse=True)
def _isolate_index_disk_cache(tmp_path, monkeypatch):
    """把两个全量索引（官方模板 / ComfyHub）的内存与磁盘缓存都换成空的。

    它们现在有磁盘兜底（`var/data/*-index.json`），跑过开发机就会留一份真实数据。
    测试若不隔离，`_hub_index()` 会先读到盘上的 827 条真数据，monkeypatch 的假响应
    根本轮不到 —— 表现为「同一份测试，干净机器上过、开发机上挂」。
    """
    from app import workflows

    monkeypatch.setattr(workflows, "_TEMPLATES_CACHE", {"at": 0.0, "items": []})
    monkeypatch.setattr(workflows, "_TEMPLATES_CACHE_FILE", tmp_path / "templates-index.json")
    monkeypatch.setattr(workflows, "_HUB_CACHE", {"at": 0.0, "items": []})
    monkeypatch.setattr(workflows, "_HUB_CACHE_FILE", tmp_path / "comfyhub-index.json")
