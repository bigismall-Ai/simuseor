"""静态资源缓存策略。

背景：这个坑踩过一次 —— 改完前端重新构建，浏览器里的页面却纹丝不动。
根因不是构建失败，而是**服务端没发 Cache-Control**：index.html 被浏览器
自己缓存住了，后端明明已经在发新产物，页面拿到的还是旧的入口文件。

锁住两条规则：
1. index.html 与任何 SPA 回退 → no-cache（入口永远取最新的）
2. 带 hash 的构建产物 → immutable 长期缓存（文件名变了就是新内容）
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app import main as main_mod


def _spa_client(tmp_dist: Path, monkeypatch: pytest.MonkeyPatch):
    """把 SPA 指向一个临时 dist 目录，返回一个 TestClient。"""
    from fastapi.testclient import TestClient

    monkeypatch.setattr(main_mod, "DIST", tmp_dist)
    return TestClient(main_mod.app)


@pytest.fixture()
def fake_dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><body>app</body></html>", encoding="utf-8")
    (dist / "main-3FZ6T6BT.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "styles-AXQ7NVNW.css").write_text("body{}", encoding="utf-8")
    (dist / "favicon.ico").write_bytes(b"\x00")
    return dist


def test_index_html_is_never_cached(fake_dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _spa_client(fake_dist, monkeypatch)
    r = client.get("/")
    assert r.status_code == 200
    assert "no-cache" in r.headers.get("cache-control", "")


def test_spa_fallback_is_never_cached(fake_dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """深链接（/models/discover）走 SPA 回退，回退出来的 index.html 同样不能缓存。"""
    client = _spa_client(fake_dist, monkeypatch)
    r = client.get("/models/discover")
    assert r.status_code == 200
    assert "no-cache" in r.headers.get("cache-control", "")


def test_hashed_assets_are_immutable(fake_dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _spa_client(fake_dist, monkeypatch)
    for path in ("/main-3FZ6T6BT.js", "/styles-AXQ7NVNW.css"):
        r = client.get(path)
        assert r.status_code == 200
        cc = r.headers.get("cache-control", "")
        assert "immutable" in cc, f"{path} 应长期缓存，实际 {cc!r}"
        assert "max-age=31536000" in cc


def test_unhashed_assets_are_not_immutable(fake_dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """没带 hash 的文件名不能长期缓存 —— 内容变了但名字没变，缓存会投毒。"""
    client = _spa_client(fake_dist, monkeypatch)
    r = client.get("/favicon.ico")
    assert r.status_code == 200
    assert "immutable" not in r.headers.get("cache-control", "")


def test_path_traversal_is_blocked(fake_dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """静态文件不能走出 dist 目录。"""
    client = _spa_client(fake_dist, monkeypatch)
    r = client.get("/../../etc/passwd")
    assert r.status_code in (200, 404)
    assert "root:" not in r.text


@pytest.mark.parametrize(
    "name,expected",
    [
        ("main-3FZ6T6BT.js", True),
        ("styles-AXQ7NVNW.css", True),
        ("chunk-5JHXF2KC.js", True),
        ("polyfills-5CFQRCPP.js", True),
        ("main.WUNEMRGM.js", True),  # Vite 风格（点号分隔）也要认
        ("index.html", False),
        ("favicon.ico", False),
        ("main.js", False),
        ("assets/logo.svg", False),
    ],
)
def test_immutable_pattern(name: str, expected: bool) -> None:
    assert bool(main_mod._IMMUTABLE.search(name)) is expected
