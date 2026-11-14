"""SQLite 持久化：下载任务 + 本地模型库。"""
from __future__ import annotations

import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from .config import DB_PATH

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  revision TEXT,
  strategy TEXT,
  save_dir TEXT,
  target_dir TEXT,
  status TEXT DEFAULT 'pending',
  error TEXT,
  total_bytes INTEGER DEFAULT 0,
  done_bytes INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS task_files (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  done_bytes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'queued',
  gid TEXT,
  url TEXT,
  candidates TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS library_models (
  id TEXT PRIMARY KEY,
  name TEXT,
  repo_id TEXT,
  source TEXT,
  local_path TEXT,
  size_bytes INTEGER DEFAULT 0,
  file_count INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS library_files (
  id TEXT PRIMARY KEY,
  model_id TEXT,
  path TEXT,
  size INTEGER DEFAULT 0,
  sha256 TEXT
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


def init_db() -> None:
    with _lock:
        conn = get_conn()
        conn.executescript(SCHEMA)
        _migrate_library_columns(conn)
        conn.commit()


# 库里删掉的列 → 迁移时从旧库剥掉。
# SQLite 没有 DROP COLUMN 的兼容写法（老版本直接报错），
# 老做法是建新表 + 拷数据 + 换名，这里按需执行一次。
_DROPPED_LIBRARY_COLUMNS = ("favorite", "review_state", "notes")


def _migrate_library_columns(conn: sqlite3.Connection) -> None:
    """把已废弃的收藏/评审/备注三列从旧库里剥掉。

    这三列对应的功能在真实使用中一次都没被用上（收藏全是入库默认值、
    评审全是 untried、备注字段存在但前端从没渲染），而模型权重是重资产，
    用户不会下载几千个模型来逐个打分 —— 留着它们只是让人以为有套打标机制。

    SQLite 的 `ALTER TABLE ... DROP COLUMN` 要 3.35+；本机是 3.53。
    老版本会抛错 → 那时保持原样，不做破坏性操作。
    """
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(library_models)")}
    except sqlite3.Error:
        return
    stale = [c for c in _DROPPED_LIBRARY_COLUMNS if c in cols]
    if not stale:
        return
    for col in stale:
        try:
            conn.execute(f"ALTER TABLE library_models DROP COLUMN {col}")
        except sqlite3.Error:
            # 老版本 SQLite：不做破坏性操作，留着列（前端已经不用了）
            continue


def query(sql: str, params: tuple = ()) -> list[dict]:
    with _lock:
        cur = get_conn().execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    return rows


def execute(sql: str, params: tuple = ()) -> str:
    with _lock:
        conn = get_conn()
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid or ""
