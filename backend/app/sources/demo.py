"""离线 Demo 源：固定假仓库，供 UI 演示与 Playwright 测试使用。"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

DEMO_FILES = [
    ("model.safetensors", 3_000_000),
    ("config.json", 1_200),
    ("tokenizer.json", 850_000),
    ("vocab.json", 220_000),
    ("README.md", 3_500),
]

DEMO_CATALOG = [
    {"id": "demo/text-gen-1.5", "name": "text-gen-1.5", "author": "demo", "description": "离线演示用文本生成模型（假数据，可完整走通下载流程）", "downloads": 12800, "likes": 356, "tags": ["text-generation", "demo"], "task": "text-generation"},
    {"id": "demo/llm-chat-7b", "name": "llm-chat-7b", "author": "demo", "description": "演示用对话模型卡片，含指令微调版本说明。", "downloads": 9200, "likes": 288, "tags": ["chat", "llm", "demo"], "task": "text-generation"},
    {"id": "demo/vision-base", "name": "vision-base", "author": "demo", "description": "演示用视觉分类基础模型。", "downloads": 7600, "likes": 210, "tags": ["vision", "demo"], "task": "image-classification"},
    {"id": "demo/diffusion-xl-lite", "name": "diffusion-xl-lite", "author": "demo", "description": "演示用文生图模型（假数据）。", "downloads": 6100, "likes": 245, "tags": ["diffusion", "text-to-image", "demo"], "task": "text-to-image"},
    {"id": "demo/audio-asr-0.2", "name": "audio-asr-0.2", "author": "demo", "description": "演示用语音识别模型。", "downloads": 3400, "likes": 98, "tags": ["audio", "asr", "demo"], "task": "automatic-speech-recognition"},
    {"id": "demo/embed-mini", "name": "embed-mini", "author": "demo", "description": "演示用文本向量模型。", "downloads": 2100, "likes": 64, "tags": ["embedding", "demo"], "task": "feature-extraction"},
]


class DemoAdapter(SourceAdapter):
    name = "demo"
    uses_repo_subdir = True

    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        repo_id = (repo_id or "demo/text-gen-1.5").strip("/")
        known = {c["id"] for c in DEMO_CATALOG} | {"text-gen-1.5", "demo"}
        if repo_id not in known and not repo_id.startswith("demo/"):
            raise SourceError("Demo 源仅提供 demo/* 离线仓库，如 demo/text-gen-1.5")
        if repo_id in ("text-gen-1.5", "demo"):
            repo_id = "demo/text-gen-1.5"
        files = [
            RemoteFile(path=p, size=s, candidates=[f"demo://{repo_id.split('/')[-1]}/{p}"])
            for p, s in DEMO_FILES
        ]
        return RepoInfo(
            repo_id=repo_id,
            display_name=repo_id.split("/")[-1],
            revision="main",
            source=self.name,
            files=files,
        )

    def search(self, q: str, limit: int, page: int, sort: str, cfg: dict, task: str = "") -> dict:
        q_lower = (q or "").lower()
        matched = [
            m
            for m in DEMO_CATALOG
            if (not task or m["task"] == task)
            and (
                not q_lower
                or q_lower in m["name"].lower()
                or q_lower in m["id"].lower()
                or any(q_lower in t for t in m["tags"])
                or q_lower in m["description"].lower()
            )
        ]
        key = {"downloads": "downloads", "likes": "likes"}.get(sort, "downloads")
        matched = sorted(matched, key=lambda m: m[key], reverse=True)
        start = (max(1, int(page)) - 1) * max(1, int(limit))
        page_items = matched[start : start + max(1, int(limit))]
        items = []
        for m in page_items:
            item = dict(m)
            item["source"] = "demo"
            item["url"] = f"https://example.invalid/models/{m['id']}"
            item["updated_at"] = "2026-11-01"
            items.append(item)
        return {"items": items, "total": len(matched)}
