"""每源代理：元数据请求（搜索/解析/封面）要和 aria2 用同一套开关。

背景：`proxy_enabled` 原来只作用于 aria2 下载，搜索/解析是裸 httpx。
TUN 模式下看不出问题（系统级接管），系统代理模式下就割裂 ——
HF / Civitai 直连被墙时，下载能走、搜索不能走。

另一条硬约束：**开了镜像就必须直连镜像**。镜像绕代理会看到海外 IP，
308 跳回官方站（实测），既没加速又白跳一次。
"""
from __future__ import annotations

import httpx
import pytest

import app.config as config
from app.sources import civitai as cv
from app.sources import huggingface as hf
from app.sources import modelscope as ms

MIRROR_CFG = {
    "proxy_enabled": True,
    "use_mirror": True,
    "mirror": "https://hf-mirror.com",
    "token": "",
}
OFFICIAL_CFG = {"proxy_enabled": True, "use_mirror": False, "mirror": "https://hf-mirror.com"}


@pytest.fixture
def proxy_settings(monkeypatch):
    """把全局代理指到一个假地址，避免读真实 settings.json。"""
    monkeypatch.setattr(
        config,
        "load_settings",
        lambda: {"proxy": {"host": "127.0.0.1", "port": 7890}},
    )
    return "http://127.0.0.1:7890"


def _resp(body: bytes = b"[]", status: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        content=body,
        request=httpx.Request("GET", "https://example.com"),
    )


def test_source_proxy_respects_per_source_switch(proxy_settings):
    assert config.source_proxy({"proxy_enabled": True}) == "http://127.0.0.1:7890"
    assert config.source_proxy({"proxy_enabled": False}) is None
    assert config.source_proxy({}) is None
    assert config.source_proxy(None) is None


def test_hf_search_uses_proxy_when_not_on_mirror(proxy_settings, monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp()

    monkeypatch.setattr(hf.httpx, "get", fake_get)
    hf.HuggingFaceAdapter().search("flux", 2, 1, "", OFFICIAL_CFG)

    assert seen["url"].startswith("https://huggingface.co/api/models")
    assert seen["proxy"] == "http://127.0.0.1:7890"


def test_hf_search_bypasses_proxy_on_mirror(proxy_settings, monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp()

    monkeypatch.setattr(hf.httpx, "get", fake_get)
    hf.HuggingFaceAdapter().search("flux", 2, 1, "", MIRROR_CFG)

    assert seen["url"].startswith("https://hf-mirror.com/api/models")
    assert seen["proxy"] is None  # 镜像必须直连，否则海外 IP → 308


def test_hf_resolve_follows_same_rule(proxy_settings, monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen["proxy"] = kwargs.get("proxy")
        return _resp(b'[{"type":"file","path":"a.bin","size":1}]')

    monkeypatch.setattr(hf.httpx, "get", fake_get)
    adapter = hf.HuggingFaceAdapter()

    adapter.resolve("a/b", "main", OFFICIAL_CFG)
    assert seen["proxy"] == "http://127.0.0.1:7890"

    adapter.resolve("a/b", "main", MIRROR_CFG)
    assert seen["proxy"] is None
    assert seen["url"].startswith("https://hf-mirror.com/api/models/")


def test_civitai_search_follows_switch_on_fixed_red_domain(proxy_settings, monkeypatch):
    """域名固定 civitai.red（不提供配置）；代理与否只看每源开关。"""
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp(b'{"items":[]}')

    monkeypatch.setattr(cv.httpx, "get", fake_get)

    cv.CivitaiAdapter().search("", 2, 1, "", {"proxy_enabled": True})
    assert seen["url"].startswith("https://civitai.red/api/v1/models")
    assert seen["proxy"] == "http://127.0.0.1:7890"

    cv.CivitaiAdapter().search("", 2, 1, "", {"proxy_enabled": False})
    assert seen["proxy"] is None

def test_civitai_search_stays_direct_when_switch_off(proxy_settings, monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        return _resp(b'{"items":[]}')

    monkeypatch.setattr(cv.httpx, "get", fake_get)
    cv.CivitaiAdapter().search("", 2, 1, "", {"proxy_enabled": False})

    assert seen["proxy"] is None


def test_modelscope_search_uses_proxy(proxy_settings, monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        return _resp(b'{"data":{"models":[],"total_count":0}}')

    monkeypatch.setattr(ms.httpx, "get", fake_get)
    ms.ModelScopeAdapter().search("flux", 2, 1, "", {"proxy_enabled": True})

    assert seen["proxy"] == "http://127.0.0.1:7890"
