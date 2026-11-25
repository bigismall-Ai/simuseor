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
    assert set(res.json()) == {"detail", "code"}
    assert res.json()["code"] == "invalid_source"
    assert "nope" in res.json()["detail"]


def test_error_envelope_for_missing_workflow_file(monkeypatch):
    def boom(_path):
        raise SourceError("工作流不存在")

    monkeypatch.setattr(routes.workflow_edit, "load", boom)
    res = client.get("/api/workflows/file", params={"path": "/tmp/none.json"})
    assert res.status_code == 400
    assert res.json() == {"detail": "工作流不存在", "code": "invalid_request"}


def test_error_code_for_missing_node_job(monkeypatch):
    def boom(_job_id, _since):
        raise SourceError("任务不存在")

    monkeypatch.setattr(routes.node_service, "job", boom)
    res = client.get("/api/nodes/job/nope")
    assert res.status_code == 404
    assert res.json()["code"] == "not_found"
    assert res.json()["detail"] == "任务不存在"


def test_error_code_for_stale_workflow(monkeypatch):
    def boom(_path, _data, _mtime):
        raise routes.workflow_edit.StaleWorkflow("文件已被其他程序修改")

    monkeypatch.setattr(routes.workflow_edit, "save", boom)
    res = client.put("/api/workflows/file", json={"path": "/tmp/a.json", "data": {}})
    assert res.status_code == 409
    assert res.json() == {"detail": "文件已被其他程序修改", "code": "conflict"}


def test_legacy_http_exception_still_detail_only(monkeypatch):
    """没迁移的端点（仍抛普通 HTTPException）只返回 detail，旧客户端不受影响。"""

    def boom(_source, _repo_id, _revision):
        raise SourceError("仓库不存在")

    monkeypatch.setattr(routes.workflow_service, "resolve", boom)
    res = client.post("/api/workflows/resolve", json={"source": "huggingface", "repo_id": "a/b"})
    assert res.status_code == 400
    assert res.json() == {"detail": "仓库不存在"}


def test_resolve_contract(monkeypatch):
    class FakeRepo:
        files = [type("F", (), {"path": "a.safetensors"})()]

        def to_dict(self):
            return {
                "repo_id": "org/model",
                "display_name": "model",
                "revision": "main",
                "source": "huggingface",
                "files": [{"path": "a.safetensors", "size": 10, "candidates": ["https://x/a"]}],
            }

    monkeypatch.setattr(routes, "load_settings", lambda: {"sources": {"huggingface": {"enabled": True}}})
    monkeypatch.setattr(routes, "get_adapter", lambda _name: type("A", (), {"resolve": lambda *a: FakeRepo()})())
    monkeypatch.setattr(routes, "plan_folders", lambda paths: {"a.safetensors": "diffusion_models"})
    monkeypatch.setattr(routes, "infer_folder", lambda *a: "diffusion_models")
    res = client.post("/api/resolve", json={"source": "huggingface", "repo_id": "org/model"})
    assert res.status_code == 200
    body = res.json()
    assert body["repo_id"] == "org/model"
    assert body["files"][0]["folder"] == "diffusion_models"
    assert body["files"][0]["candidates"] == ["https://x/a"]
    assert body["target_folder"] == "diffusion_models"


def test_library_facets_contract(monkeypatch):
    rows = [
        {
            "local_path": "/tmp/a.safetensors",
            "name": "a.safetensors",
            "tags": "[]",
            "size_bytes": 1024,
            "source": "huggingface",
            "repo_id": "Org/model",
        },
        {
            "local_path": "/tmp/b.safetensors",
            "name": "b.safetensors",
            "tags": '["flux"]',
            "size_bytes": 2048,
            "source": "huggingface",
            "repo_id": "Org/other",
        },
    ]
    monkeypatch.setattr(routes, "query", lambda sql, params=(): rows)
    monkeypatch.setattr(
        routes,
        "describe_model",
        lambda *args: {"folder": "diffusion_models", "folderLabel": "扩散模型", "task": "text_to_image", "taskLabel": "文生图"},
    )
    monkeypatch.setattr(routes, "flush_meta_cache", lambda: None)
    monkeypatch.setattr(routes, "all_folders", lambda: [{"id": "loras", "label": "LoRA"}])
    monkeypatch.setattr(routes, "all_tasks", lambda: [{"id": "text_to_image", "label": "文生图"}])
    res = client.get("/api/library/facets")
    assert res.status_code == 200
    body = res.json()
    assert body["folder"][0] == {"id": "diffusion_models", "label": "扩散模型", "count": 2, "sizeText": "3.0 KB"}
    assert body["publisher"][0]["id"] == "org"
    assert body["publisher"][0]["label"] == "Org"
    assert body["source"][0]["count"] == 2
    assert body["allFolders"] == [{"id": "loras", "label": "LoRA"}]
    assert body["allTasks"] == [{"id": "text_to_image", "label": "文生图"}]


def test_nodes_search_contract(monkeypatch):
    payload = {
        "items": [
            {
                "id": "org/pack",
                "name": "Pack",
                "author": "org",
                "repo": "https://github.com/org/pack",
                "description": "",
                "category": "sampling",
                "tags": [],
                "nodes": ["A"],
                "node_count": 1,
                "install_type": "git-clone",
                "installable": True,
                "installed": False,
                "mirror": "https://mirror/org/pack",
            }
        ],
        "total": 1,
        "done": True,
        "errors": {},
        "sorts": ["nodes", "name", "default"],
        "categories": [{"id": "sampling", "label": "采样", "count": 1}],
        "category": "",
        "installed_count": 0,
    }
    monkeypatch.setattr(routes.node_service, "search", lambda *a: payload)
    # 热力榜可能已经从 var/data 读到真实缓存，测试里绕开它
    monkeypatch.setattr(routes.hot_board, "matches", lambda *a, **kw: False)
    res = client.get("/api/nodes")
    assert res.status_code == 200
    body = res.json()
    assert body["items"][0]["node_count"] == 1
    assert body["items"][0]["mirror"].endswith("/pack")
    assert body["sorts"] == ["nodes", "name", "default"]
    assert body["installed_count"] == 0


def test_nodes_stats_contract(monkeypatch):
    monkeypatch.setattr(
        routes.node_service,
        "stats",
        lambda: {
            "catalog": 10,
            "installed": 3,
            "disabled": 1,
            "node_classes": 99,
            "core_nodes": 42,
            "dir": "/tmp/custom_nodes",
            "runtime": "env",
        },
    )
    res = client.get("/api/nodes/stats")
    assert res.status_code == 200
    assert res.json()["catalog"] == 10
    assert res.json()["core_nodes"] == 42
    assert res.json()["runtime"] == "env"


def test_nodes_missing_contract(monkeypatch):
    monkeypatch.setattr(
        routes.node_service,
        "missing",
        lambda: {
            "workflows": [
                {
                    "name": "wf",
                    "file": "wf.json",
                    "path": "/tmp/wf.json",
                    "used": 3,
                    "missing": 1,
                    "providers": [
                        {
                            "id": "org/pack",
                            "name": "Pack",
                            "author": "org",
                            "repo": "https://github.com/org/pack",
                            "node_count": 1,
                            "installable": True,
                            "covers": ["A"],
                        }
                    ],
                    "unknown": [],
                }
            ],
            "providers": [
                {
                    "id": "org/pack",
                    "name": "Pack",
                    "author": "org",
                    "repo": "https://github.com/org/pack",
                    "node_count": 1,
                    "installable": True,
                    "covers": ["A"],
                    "files": 1,
                }
            ],
            "scanned": 1,
            "missing_files": 1,
            "core_nodes": 42,
            "installed_nodes": 3,
        },
    )
    res = client.get("/api/nodes/missing")
    assert res.status_code == 200
    body = res.json()
    assert body["workflows"][0]["providers"][0]["covers"] == ["A"]
    assert body["providers"][0]["files"] == 1
    assert body["missing_files"] == 1


def test_error_code_for_missing_library_model(monkeypatch):
    monkeypatch.setattr(routes, "query", lambda sql, params=(): [])
    res = client.patch("/api/library/nope", json={"tags": []})
    assert res.status_code == 404
    assert res.json() == {"detail": "模型不存在", "code": "not_found"}


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
        ("/api/search", "get"),
        ("/api/library", "get"),
        ("/api/probe", "get"),
        ("/api/device", "get"),
        ("/api/resolve", "post"),
        ("/api/library/facets", "get"),
        ("/api/nodes", "get"),
        ("/api/nodes/stats", "get"),
        ("/api/nodes/missing", "get"),
    ]:
        assert method in schema["paths"][path]

    names = schema["components"]["schemas"]
    assert "TaskItem" in names
    assert "TaskFile" in names
    assert "WorkflowLocalList" in names
    assert "NodeInstalledList" in names
    assert "SearchResponse" in names
    assert "LibraryItem" in names
    assert "ProbeResponse" in names
    assert "DeviceInfo" in names
    assert "ResolveResponse" in names
    assert "ResolveFile" in names
    assert "LibraryFacets" in names
    assert "LibraryFacet" in names
    assert "NodeSearchResponse" in names
    assert "NodeCatalogItem" in names
    assert "NodeStatsResponse" in names
    assert "NodeMissingResponse" in names
    # 这五个端点必须真的挂了 response_model，而不是只存在于 paths
    ref = lambda path, method: schema["paths"][path][method]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref("/api/resolve", "post").endswith("/ResolveResponse")
    assert ref("/api/library/facets", "get").endswith("/LibraryFacets")
    assert ref("/api/nodes", "get").endswith("/NodeSearchResponse")
    assert ref("/api/nodes/stats", "get").endswith("/NodeStatsResponse")
    assert ref("/api/nodes/missing", "get").endswith("/NodeMissingResponse")


def test_search_contract(monkeypatch):
    payload = {
        "items": [
            {
                "id": "org/model",
                "name": "model",
                "author": "org",
                "source": "huggingface",
                "description": "",
                "downloads": 1,
                "likes": 2,
                "tags": ["flux"],
                "task": "text-to-image",
                "url": "https://huggingface.co/org/model",
                "updated_at": "2026-01-01T00:00:00Z",
                "image": "https://example.com/a.png",
            }
        ],
        "total": 1,
        "errors": {},
        "gated": [],
    }
    monkeypatch.setattr(routes.cache, "get_search", lambda key: payload)
    res = client.get("/api/search", params={"q": "flux"})
    assert res.status_code == 200
    assert res.json()["items"][0]["image"].endswith("a.png")


def test_library_contract(monkeypatch):
    model = {
        "id": "m1",
        "name": "model.safetensors",
        "repo_id": "org/model",
        "source": "huggingface",
        "local_path": "/tmp/model.safetensors",
        "size_bytes": 10,
        "file_count": 1,
        "tags": '["flux"]',
        "created_at": "2026-01-01T00:00:00Z",
        "revision": "",
        "source_url": "",
        "folder": "diffusion_models",
        "folderLabel": "扩散模型",
        "task": "text-to-image",
        "taskLabel": "文生图",
        "vram": {"level": "ok", "text": "可运行", "hint": ""},
    }

    def fake_query(sql, params=()):
        if "FROM library_models" in sql:
            return [dict(model)]
        if "FROM library_files" in sql:
            return [{"id": "f1", "path": "model.safetensors", "size": 10}]
        return []

    monkeypatch.setattr(routes, "query", fake_query)
    monkeypatch.setattr(routes, "describe_model", lambda *args: {})
    monkeypatch.setattr(routes, "flush_meta_cache", lambda: None)
    res = client.get("/api/library")
    assert res.status_code == 200
    assert res.json()[0]["vram"]["level"] == "ok"
    assert res.json()[0]["files"][0]["path"] == "model.safetensors"


def test_probe_contract(monkeypatch):
    path = {
        "path": "direct",
        "state": "ok",
        "latency_ms": 100,
        "speed_mbps": 8.2,
        "reason": "",
        "reason_text": "",
        "detail": "",
        "skip": "",
        "restricted": False,
    }
    monkeypatch.setattr(
        routes.probe,
        "status",
        lambda: {
            "sources": [
                {
                    "source": "huggingface",
                    "label": "Hugging Face",
                    "verdict": "ok",
                    "paths": {"direct": path, "mirror": path, "proxy": path},
                    "path": "direct",
                    "path_text": "直连",
                    "fallback": False,
                    "gated": False,
                    "checked_at": 1,
                    "age_seconds": 2,
                }
            ],
            "strategy": "direct",
            "summary": {},
            "cooldown": {},
        },
    )
    res = client.get("/api/probe")
    assert res.status_code == 200
    assert res.json()["sources"][0]["paths"]["direct"]["state"] == "ok"


def test_device_contract(monkeypatch):
    from app.comfy import probe as hw

    class Report:
        def model_dump(self):
            return {
                "os": "windows",
                "os_version": "11",
                "os_build": "26100",
                "arch": "x86_64",
                "is_wsl": False,
                "memory_gb": 64,
                "unified_memory": False,
                "gpus": [],
                "primary_gpu": None,
                "pythons": [],
                "instances": [],
                "disks": [],
                "raw": {},
            }

    monkeypatch.setattr(hw, "hardware_snapshot", lambda: Report())
    monkeypatch.setattr(
        routes,
        "gpu_snapshot",
        lambda: {"name": "RTX", "vendor": "nvidia", "vramMb": 16376, "vramGb": 15.99, "vramText": "16 GB"},
    )
    monkeypatch.setattr(routes, "load_settings", lambda: {"download": {"save_dir": "/tmp"}})
    res = client.get("/api/device")
    assert res.status_code == 200
    assert res.json()["os"] == "windows"
    assert res.json()["gpu"]["vramMb"] == 16376
