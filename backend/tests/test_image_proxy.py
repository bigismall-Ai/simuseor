"""封面图代理：白名单、重定向校验、按源代理、磁盘缓存。"""
from __future__ import annotations

import httpx
import pytest

import app.config as config
from app import image_proxy

CIVITAI = "https://image.civitai.com/x/abc/original=true/1.jpeg"


def _resp(url: str, status: int = 200, headers: dict | None = None, body: bytes = b"IMG") -> ImageResp:
    return ImageResp(url, status, headers or {"content-type": "image/jpeg"}, body)


class ImageResp:
    def __init__(self, url, status, headers, body):
        self.status_code = status
        self.headers = headers
        self._url = httpx.URL(url)
        self._body = body

    @property
    def url(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def iter_bytes(self):
        yield self._body


class FakeClient:
    calls: list[dict] = []
    next_response = None

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        FakeClient.calls.append(kwargs)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def stream(self, method, url):
        return FakeClient.next_response or _resp(url)


@pytest.fixture(autouse=True)
def isolate(monkeypatch, tmp_path):
    FakeClient.calls = []
    monkeypatch.setattr(image_proxy, "CACHE_DIR", tmp_path / "covers")
    monkeypatch.setattr(image_proxy.httpx, "Client", FakeClient)
    monkeypatch.setattr(config, "load_settings", lambda: {
        "proxy": {"host": "127.0.0.1", "port": 7890},
        "sources": {"civitai": {"proxy_enabled": True}},
    })


def test_rejects_host_outside_allowlist():
    with pytest.raises(image_proxy.CoverError) as exc:
        image_proxy.get("https://evil.example.com/a.jpg")
    assert exc.value.status == 403
    assert FakeClient.calls == []  # 根本不该发请求


def test_fetches_and_caches(tmp_path):
    FakeClient.next_response = _resp(CIVITAI, 200, {"content-type": "image/jpeg"}, b"JPEGDATA")

    path, media = image_proxy.get(CIVITAI)
    assert media == "image/jpeg"
    assert path.read_bytes() == b"JPEGDATA"
    assert len(FakeClient.calls) == 1

    # 第二次命中磁盘，不再发请求
    again, media2 = image_proxy.get(CIVITAI)
    assert again == path and media2 == media
    assert len(FakeClient.calls) == 1


def test_uses_source_proxy():
    FakeClient.next_response = _resp(CIVITAI)
    image_proxy.get(CIVITAI)
    assert FakeClient.calls[0]["proxy"] == "http://127.0.0.1:7890"


def test_rejects_redirect_to_unknown_host():
    FakeClient.next_response = _resp(
        "https://evil.example.com/a.jpg", 200, {"content-type": "image/jpeg"}
    )
    with pytest.raises(image_proxy.CoverError) as exc:
        image_proxy.get(CIVITAI)
    assert exc.value.status == 502
    assert "重定向" in str(exc.value)


def test_rejects_non_image():
    FakeClient.next_response = _resp(CIVITAI, 200, {"content-type": "text/html"})
    with pytest.raises(image_proxy.CoverError):
        image_proxy.get(CIVITAI)


def test_rejects_oversized(monkeypatch):
    monkeypatch.setattr(image_proxy, "MAX_BYTES", 8)
    FakeClient.next_response = _resp(CIVITAI, 200, {"content-type": "image/png"}, b"x" * 64)
    with pytest.raises(image_proxy.CoverError):
        image_proxy.get(CIVITAI)
