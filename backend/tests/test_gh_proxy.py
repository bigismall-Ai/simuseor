"""GitHub 加速前缀（族 1：`{前缀}` + 完整 URL）。

现存公共反代全是这一族写法（gh-proxy / ghfast / githubproxy / ghproxy.net 实测 4/4 通），
「前缀 + 去协议」只有 3/4，「域名替换式」（kkgithub / bgithub）已全部失效。
所以只支持一种格式，配置里存的就是那个前缀。

前缀与代理**互斥**：前缀本身就是另一条通路，两个一起套等于多绕一层。
"""
from __future__ import annotations

import httpx

from app import config
from app import nodes


def _fake_settings(mirror: str = "", proxy_enabled: bool = False) -> dict:
    return {
        "sources": {"github": {"mirror": mirror, "proxy_enabled": proxy_enabled}},
        "proxy": {"host": "127.0.0.1", "port": 7890},
    }


def test_no_prefix_means_direct(monkeypatch):
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings())
    assert config.gh_proxy_prefix() == ""
    assert config.gh_url("https://raw.githubusercontent.com/a/b") == (
        "https://raw.githubusercontent.com/a/b"
    )


def test_prefix_accepts_bare_host_and_adds_slash(monkeypatch):
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings("gh-proxy.com"))
    assert config.gh_proxy_prefix() == "https://gh-proxy.com/"
    assert config.gh_url("https://raw.githubusercontent.com/a/b") == (
        "https://gh-proxy.com/https://raw.githubusercontent.com/a/b"
    )


def test_prefix_keeps_existing_scheme_and_slash(monkeypatch):
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings("https://gh-proxy.com/"))
    assert config.gh_proxy_prefix() == "https://gh-proxy.com/"


def test_non_http_urls_are_untouched(monkeypatch):
    """demo:// 这类内部地址不能被套前缀。"""
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings("https://gh-proxy.com/"))
    assert config.gh_url("demo://local/file.bin") == "demo://local/file.bin"


def test_prefix_wins_over_proxy(monkeypatch):
    """填了前缀就不再经代理 —— 否则是「代理里再走反代」多绕一层。"""
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings("https://gh-proxy.com/", True))
    assert config.gh_proxy({"proxy_enabled": True}) is None


def test_without_prefix_proxy_follows_source_switch(monkeypatch):
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings("", True))
    assert config.gh_proxy({"proxy_enabled": True}) == "http://127.0.0.1:7890"
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings("", False))
    assert config.gh_proxy({"proxy_enabled": False}) is None


def test_node_catalog_fetch_uses_prefix(monkeypatch):
    """节点清单 5.7MB 在 raw 上，直连必断：接上前缀后才可能拉下来。"""
    monkeypatch.setattr(config, "load_settings", lambda: _fake_settings("https://gh-proxy.com/"))
    seen = {}

    def fake_get(url, **kw):
        seen["url"] = url
        seen.update(kw)
        return httpx.Response(200, json={})

    monkeypatch.setattr(nodes.httpx, "get", fake_get)
    nodes._fetch(nodes.CNL_URL)

    assert seen["url"] == f"https://gh-proxy.com/{nodes.CNL_URL}"
    assert seen.get("proxy") is None
