"""进程内 TTL 缓存：给搜索这类「短时间内重复请求、结果不要求实时」的读接口用。

为什么不用 SQLite：搜索结果是纯派生数据，重启即失效也没关系；写库反而多一层
迁移与清理负担。这里就是一个带锁的 dict + 过期时间，有界淘汰最旧的一条。

进程内缓存的前提是单进程部署（uvicorn 单 worker）。改成多 worker 时这里会各存
各的，只是命中率下降，不会出错，所以不必为它引入 Redis。
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any


class TtlCache:
    def __init__(self, ttl: float, maxsize: int = 128) -> None:
        self._ttl = ttl
        self._max = maxsize
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return None
            stamp, value = hit
            if time.time() - stamp > self._ttl:
                del self._data[key]
                return None
            self._data.move_to_end(key)  # LRU：命中即续命
            return value

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.time(), value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


_search = TtlCache(ttl=1200, maxsize=128)


def get_search(key: str) -> dict | None:
    return _search.get(key)


def put_search(key: str, value: dict) -> None:
    _search.put(key, value)


def clear_search() -> None:
    """设置变更（token / 完整目录 / 代理）后必须清空，否则旧结果会盖住新配置。"""
    _search.clear()
