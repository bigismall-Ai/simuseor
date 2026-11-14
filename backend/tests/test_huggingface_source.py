"""Hugging Face 源：搜索/解析必须跟随 308 重定向，且非 JSON 响应要给出可读错误。

背景（2026-11 实测）：hf-mirror.com 不再代理 API —— `/api/models` 与
`/api/models/{id}/tree/...` 一律 308 跳到 huggingface.co，响应体为空。
旧代码在 search() 里没传 follow_redirects，`resp.json()` 抛 JSONDecodeError
一路冒到 500，前端只显示「搜索失败，请检查网络」，把「镜像已失效」误报成网络问题。
"""
from __future__ import annotations

import httpx
import pytest

from app.sources import huggingface as hf
from app.sources.base import SourceError

CFG_MIRROR = {"use_mirror": True, "mirror": "https://hf-mirror.com", "token": ""}


def _resp(status: int, body: bytes = b"", headers: dict | None = None) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        headers=headers or {},
        content=body,
        request=httpx.Request("GET", "https://hf-mirror.com/api/models"),
    )


def test_search_follows_redirects(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp(
            200,
            b'[{"id":"black-forest-labs/FLUX.1-dev","author":"black-forest-labs",'
            b'"downloads":10,"likes":2,"tags":["text-to-image"],"pipeline_tag":"text-to-image"}]',
        )

    monkeypatch.setattr(hf.httpx, "get", fake_get)
    out = hf.HuggingFaceAdapter().search("flux", 2, 1, "downloads", CFG_MIRROR)

    assert seen["follow_redirects"] is True
    assert seen["url"].startswith("https://hf-mirror.com/api/models")
    assert out["items"][0]["id"] == "black-forest-labs/FLUX.1-dev"


def test_search_reports_dead_mirror_instead_of_crashing(monkeypatch):
    """镜像 308 空响应：要抛 SourceError（带状态码与去向），不能是 JSONDecodeError。"""

    def fake_get(url, **kwargs):
        return _resp(308, b"", {"location": "https://huggingface.co/api/models"})

    monkeypatch.setattr(hf.httpx, "get", fake_get)

    with pytest.raises(SourceError) as exc:
        hf.HuggingFaceAdapter().search("flux", 2, 1, "", CFG_MIRROR)

    msg = str(exc.value)
    assert "308" in msg
    assert "huggingface.co/api/models" in msg
    assert "镜像" in msg


def test_resolve_follows_redirects_and_decodes(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp(
            200,
            b'[{"type":"file","path":"model.safetensors","size":123},'
            b'{"type":"directory","path":"sub","size":0}]',
        )

    monkeypatch.setattr(hf.httpx, "get", fake_get)
    info = hf.HuggingFaceAdapter().resolve("a/b", "main", CFG_MIRROR)

    assert seen["follow_redirects"] is True
    assert [f.path for f in info.files] == ["model.safetensors"]


def test_resolve_reports_non_json_body(monkeypatch):
    monkeypatch.setattr(hf.httpx, "get", lambda url, **kw: _resp(200, b"<html>oops</html>"))

    with pytest.raises(SourceError) as exc:
        hf.HuggingFaceAdapter().resolve("a/b", "main", CFG_MIRROR)

    assert "不是 JSON" in str(exc.value)
