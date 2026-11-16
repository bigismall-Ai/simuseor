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
