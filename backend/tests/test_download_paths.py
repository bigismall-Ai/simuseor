"""下载落点判定：工作流目录与模型目录必须区分开。"""
from __future__ import annotations

from pathlib import Path

from app.download import manager as manager_module


def test_workflow_target_detected(tmp_path: Path, monkeypatch) -> None:
    shared = tmp_path / "workspace" / "userdata" / "default" / "workflows"
    shared.mkdir(parents=True)
    monkeypatch.setattr(manager_module, "WORKSPACE_WORKFLOWS_DIR", shared)

    assert manager_module._is_workflow_target(shared / "some-repo") is True
    assert manager_module._is_workflow_target(shared) is True


def test_model_target_is_not_workflow(tmp_path: Path, monkeypatch) -> None:
    shared = tmp_path / "workspace" / "userdata" / "default" / "workflows"
    models = tmp_path / "workspace" / "models"
    shared.mkdir(parents=True)
    models.mkdir(parents=True)
    monkeypatch.setattr(manager_module, "WORKSPACE_WORKFLOWS_DIR", shared)

    assert manager_module._is_workflow_target(models / "checkpoints" / "qwen") is False
    # 名字里带 workflows 但不在共享库下，仍算模型目录
    assert manager_module._is_workflow_target(models / "workflows") is False
