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
  favorite INTEGER DEFAULT 0,
  review_state TEXT DEFAULT 'untried',
  notes TEXT DEFAULT '',
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
        conn.commit()


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
