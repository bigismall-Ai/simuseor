"""工作流搜索/取图也要跟随每源代理与镜像规则。

模型源修完之后，工作流搜索还是另一套裸 httpx：TUN 关闭时 HF / Civitai 直接超时
（`WinError 10060`）。这里锁住三条规则：
- 开镜像 → 打镜像且不套代理（绕代理会被判成海外 IP 并 308 回官方）
- 关镜像 + 开代理 → 打官方站并套代理
- Civitai → 按该源开关套代理
"""
from __future__ import annotations

import httpx
import pytest

import app.config as config
from app import workflows
from app.sources.base import SourceError

PROXY = "http://127.0.0.1:7890"


def _resp(body: bytes = b"[]") -> httpx.Response:
    return httpx.Response(
        status_code=200, content=body, request=httpx.Request("GET", "https://example.com")
    )


@pytest.fixture(autouse=True)
def proxy_settings(monkeypatch):
    monkeypatch.setattr(config, "load_settings", lambda: {"proxy": {"host": "127.0.0.1", "port": 7890}})


def _patch_cfg(monkeypatch, mapping: dict):
    monkeypatch.setattr(workflows, "_source_cfg", lambda name: mapping.get(name, {}))


def test_hf_workflow_search_bypasses_proxy_on_mirror(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp()

    monkeypatch.setattr(workflows.httpx, "get", fake_get)
    _patch_cfg(monkeypatch, {"huggingface": {
        "use_mirror": True, "mirror": "https://hf-mirror.com", "proxy_enabled": True,
    }})

    workflows._search_huggingface("flux", 2, 1)

    assert seen["url"].startswith("https://hf-mirror.com/api/models")
    assert seen["proxy"] is None


def test_hf_workflow_search_uses_proxy_off_mirror(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp()

    monkeypatch.setattr(workflows.httpx, "get", fake_get)
    _patch_cfg(monkeypatch, {"huggingface": {"use_mirror": False, "proxy_enabled": True}})

    workflows._search_huggingface("flux", 2, 1)

    assert seen["url"].startswith("https://huggingface.co/api/models")
    assert seen["proxy"] == PROXY


def test_civitai_workflow_search_uses_proxy(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        return _resp(b'{"items":[]}')

    monkeypatch.setattr(workflows.httpx, "get", fake_get)
    _patch_cfg(monkeypatch, {"civitai": {"proxy_enabled": True}})
    workflows._CIVITAI_CURSORS.clear()

    workflows._search_civitai("flux", 2, 1)

    assert seen["proxy"] == PROXY


def test_modelscope_workflow_search_stays_direct_when_off(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        return _resp(b'{"data":{"models":[]}}')

    monkeypatch.setattr(workflows.httpx, "get", fake_get)
    _patch_cfg(monkeypatch, {"modelscope": {"proxy_enabled": False}})

    workflows._search_modelscope("flux", 2, 1)

    assert seen["proxy"] is None
