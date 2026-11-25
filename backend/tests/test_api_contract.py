"""API 契约：响应字段、错误信封与 OpenAPI 快照。

这些测试不联网、不读真实资产：只锁接口形状。
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.sources.base import SourceError

BACKEND = Path(__file__).resolve().parents[1]
client = TestClient(app)


def test_health_contract():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "web": bool(res.json()["web"])}


def test_folders_contract(monkeypatch):
    monkeypatch.setattr(routes, "all_folders", lambda: [{"id": "loras", "label": "LoRA", "extra": "ignored"}])
    res = client.get("/api/folders")
    assert res.status_code == 200
    assert res.json() == [{"id": "loras", "label": "LoRA"}]


def test_gpu_contract(monkeypatch):
    monkeypatch.setattr(
        routes,
        "gpu_snapshot",
        lambda: {"name": "RTX", "vendor": "nvidia", "vramMb": 16376, "vramGb": 15.99, "vramText": "16 GB"},
    )
    res = client.get("/api/library/gpu")
    assert res.status_code == 200
    assert res.json()["vramMb"] == 16376
    assert res.json()["vramText"] == "16 GB"


def _task() -> dict:
    return {
        "id": "t1",
        "source": "huggingface",
        "repo_id": "org/model",
        "revision": "main",
        "strategy": "mirror",
        "save_dir": "/tmp/models",
        "target_dir": "/tmp/models/diffusion_models",
        "status": "downloading",
        "error": None,
        "total_bytes": 10,
        "done_bytes": 5,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:01Z",
        "path": "mirror",
        "kind": "diffusion_models",
        "files": [
            {
                "id": "f1",
                "task_id": "t1",
                "path": "model.safetensors",
                "size": 10,
                "done_bytes": 5,
                "status": "active",
                "gid": "g",
                "url": "",
                "candidates": [],
                "error": None,
                "folder": "diffusion_models",
                "target_dir": "/tmp/models/diffusion_models",
            }
        ],
    }


def test_tasks_contract(monkeypatch):
    monkeypatch.setattr(routes.manager, "list_tasks", lambda: [_task()])
    res = client.get("/api/tasks")
    assert res.status_code == 200
    body = res.json()
    assert body[0]["id"] == "t1"
    assert body[0]["files"][0]["status"] == "active"
    # extra="allow" 的历史字段不能丢
    assert body[0]["files"][0]["target_dir"].endswith("diffusion_models")


def test_task_detail_contract(monkeypatch):
    monkeypatch.setattr(routes.manager, "get_task", lambda task_id: _task())
    res = client.get("/api/tasks/t1")
    assert res.status_code == 200
    assert res.json()["kind"] == "diffusion_models"


def test_workflows_local_contract(monkeypatch):
    monkeypatch.setattr(
        routes.workflow_service,
        "local",
        lambda: {
            "dir": "/tmp/wf",
            "total": 1,
            "items": [
                {
                    "name": "a.json",
                    "key": "a.json",
                    "path": "/tmp/wf/a.json",
                    "nodes": 3,
                    "format": "ui",
                    "main_model": "m.safetensors",
                    "model_slots": [],
                    "deps": {},
                    "node_deps": {},
                    "cover": "",
                }
            ],
            "groups": [{"name": "人像", "count": 1}],
        },
    )
    res = client.get("/api/workflows/local")
    assert res.status_code == 200
    assert res.json()["items"][0]["name"] == "a.json"
    assert res.json()["groups"][0]["count"] == 1


def test_nodes_installed_contract(monkeypatch):
    monkeypatch.setattr(
        routes.node_service,
        "installed",
        lambda: [
            {
                "name": "x",
                "dir": "x",
                "path": "/tmp/x",
                "disabled": False,
                "repo": "",
                "id": "",
                "title": "X",
                "description": "",
                "node_count": 2,
                "nodes": ["A", "B"],
                "tracked": False,
                "requirements": False,
                "commit": "",
                "size": 0,
            }
        ],
    )
    res = client.get("/api/nodes/installed")
    assert res.status_code == 200
    assert res.json()["items"][0]["nodes"] == ["A", "B"]


def test_error_envelope_for_unknown_source(monkeypatch):
    monkeypatch.setattr(routes, "load_settings", lambda: {"sources": {}})
    res = client.post("/api/resolve", json={"source": "nope", "repo_id": "a/b"})
    assert res.status_code == 400
    assert set(res.json()) == {"detail"}
    assert "nope" in res.json()["detail"]


def test_error_envelope_for_missing_workflow_file(monkeypatch):
    def boom(_path):
        raise SourceError("工作流不存在")

    monkeypatch.setattr(routes.workflow_edit, "load", boom)
    res = client.get("/api/workflows/file", params={"path": "/tmp/none.json"})
    assert res.status_code == 400
    assert res.json() == {"detail": "工作流不存在"}


def test_openapi_snapshot_is_current():
    expected = json.loads(io.open(BACKEND / "openapi.json", encoding="utf-8").read())
    assert app.openapi() == expected, "OpenAPI 已变化，运行：.venv/Scripts/python backend/scripts/dump_openapi.py"


def test_openapi_locks_core_paths_and_models():
    schema = app.openapi()
    for path, method in [
        ("/api/health", "get"),
        ("/api/folders", "get"),
        ("/api/tasks", "get"),
        ("/api/tasks/{task_id}", "get"),
        ("/api/workflows/local", "get"),
        ("/api/nodes/installed", "get"),
        ("/api/library/gpu", "get"),
    ]:
        assert method in schema["paths"][path]

    names = schema["components"]["schemas"]
    assert "TaskItem" in names
    assert "TaskFile" in names
    assert "WorkflowLocalList" in names
    assert "NodeInstalledList" in names
