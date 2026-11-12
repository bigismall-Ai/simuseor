"""工作流收尾：zip 解包只保留真正的工作流 json，且不覆盖同名文件。"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

from app.workflows import extract_workflow_archives


def _zip(path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)


def test_extract_flattens_and_drops_non_workflow(tmp_path: Path) -> None:
    workflow = json.dumps({"nodes": [{"id": 1}], "links": []}).encode()
    config = json.dumps({"some": "settings"}).encode()
    _zip(
        tmp_path / "pack.zip",
        {
            "pack/workflow.json": workflow,
            "pack/readme.md": b"# hello",
            "pack/config.json": config,
            "__MACOSX/._workflow.json": b"junk",
        },
    )

    saved = extract_workflow_archives(tmp_path)

    assert saved == ["workflow.json"]
    assert (tmp_path / "workflow.json").is_file()
    # 配置类 json 不该被当成工作流摊进面板
    assert not (tmp_path / "config.json").exists()
    # 压缩包解完就删，别让用户看到点不开的条目
    assert not (tmp_path / "pack.zip").exists()


def test_extract_keeps_existing_files(tmp_path: Path) -> None:
    (tmp_path / "workflow.json").write_text('{"nodes": []}', encoding="utf-8")
    _zip(tmp_path / "pack.zip", {"workflow.json": b'{"nodes": [1]}'})

    saved = extract_workflow_archives(tmp_path)

    assert saved == ["workflow-2.json"]
    assert json.loads((tmp_path / "workflow.json").read_text(encoding="utf-8")) == {"nodes": []}
    assert json.loads((tmp_path / "workflow-2.json").read_text(encoding="utf-8")) == {"nodes": [1]}


def test_extract_ignores_broken_archive(tmp_path: Path) -> None:
    (tmp_path / "broken.zip").write_bytes(b"not a zip")

    assert extract_workflow_archives(tmp_path) == []
    # 坏包保留原样，让用户还能自己处理
    assert (tmp_path / "broken.zip").is_file()
