"""模型库的来源原址：URL 拼装 + 老库回填。"""
from __future__ import annotations

import sqlite3

from app import db
from app.source_urls import source_page_url


def test_huggingface_root_and_revision():
    base = "https://huggingface.co/black-forest-labs/FLUX.1-dev"
    assert source_page_url("huggingface", "black-forest-labs/FLUX.1-dev", "") == base
    assert source_page_url("huggingface", "black-forest-labs/FLUX.1-dev", "main") == base
    assert (
        source_page_url("huggingface", "black-forest-labs/FLUX.1-dev", "abc123")
        == f"{base}/tree/abc123"
    )


def test_civitai_version_page():
    assert source_page_url("civitai", "128374", "") == "https://civitai.com/models/128374"
    assert (
        source_page_url("civitai", "128374", "123456")
        == "https://civitai.com/models/128374?modelVersionId=123456"
    )


def test_modelscope_and_github():
    assert (
        source_page_url("modelscope", "Wan-AI/Wan2.2-T2V-A14B", "master")
        == "https://modelscope.cn/models/Wan-AI/Wan2.2-T2V-A14B"
    )
    assert source_page_url("github", "comfyanonymous/ComfyUI", "main") == "https://github.com/comfyanonymous/ComfyUI"


def test_no_remote_page_for_local_sources():
    assert source_page_url("imported", "", "") == ""
    assert source_page_url("demo", "demo/text-gen-1.5", "main") == ""
    assert source_page_url("", "x", "") == ""


def _old_db() -> sqlite3.Connection:
    """旧库结构：library_models 没有 revision / source_url。"""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE tasks (
          id TEXT, source TEXT, repo_id TEXT, revision TEXT,
          target_dir TEXT, status TEXT, created_at TEXT
        );
        CREATE TABLE library_models (
          id TEXT PRIMARY KEY, name TEXT, repo_id TEXT, source TEXT,
          local_path TEXT, size_bytes INTEGER, file_count INTEGER,
          tags TEXT, created_at TEXT
        );
        """
    )
    return conn


def test_backfill_uses_latest_completed_task():
    conn = _old_db()
    conn.execute(
        "INSERT INTO tasks VALUES ('t1','huggingface','org/repo','abc123','E:/m/repo','completed','2026-01-01')"
    )
    conn.execute(
        "INSERT INTO tasks VALUES ('t2','huggingface','org/repo','main','E:/m/repo','completed','2026-01-02')"
    )
    conn.execute(
        "INSERT INTO library_models (id,name,repo_id,source,local_path,size_bytes,file_count,tags,created_at)"
        " VALUES ('m1','repo','org/repo','huggingface','E:/m/repo',1,1,'[]','2026-01-03')"
    )

    db._ensure_library_columns(conn)
    db._backfill_library_origin(conn)

    row = conn.execute("SELECT revision, source_url FROM library_models WHERE id='m1'").fetchone()
    assert row["revision"] == "main"
    assert row["source_url"] == "https://huggingface.co/org/repo"


def test_backfill_keeps_civitai_version():
    conn = _old_db()
    conn.execute(
        "INSERT INTO tasks VALUES ('t1','civitai','128374','123456','E:/m/wai','completed','2026-01-01')"
    )
    conn.execute(
        "INSERT INTO library_models (id,name,repo_id,source,local_path,size_bytes,file_count,tags,created_at)"
        " VALUES ('m1','wai','128374','civitai','E:/m/wai',1,1,'[]','2026-01-03')"
    )

    db._ensure_library_columns(conn)
    db._backfill_library_origin(conn)

    row = conn.execute("SELECT revision, source_url FROM library_models WHERE id='m1'").fetchone()
    assert row["revision"] == "123456"
    assert row["source_url"] == "https://civitai.com/models/128374?modelVersionId=123456"


def test_backfill_skips_local_import():
    conn = _old_db()
    conn.execute(
        "INSERT INTO library_models (id,name,repo_id,source,local_path,size_bytes,file_count,tags,created_at)"
        " VALUES ('m1','local','','imported','E:/m/local',1,1,'[]','2026-01-03')"
    )

    db._ensure_library_columns(conn)
    db._backfill_library_origin(conn)

    row = conn.execute("SELECT source_url FROM library_models WHERE id='m1'").fetchone()
    assert row["source_url"] is None
