"""源探针的判定与门控：四态、20% 代理门槛、手动指定与回退。

这些是纯逻辑（不联网）：探针的实测量由 backend/app/probe.py 负责，
这里守住「结论怎么变成行为」那一层 —— 门控只由 down 触发、手动指定不受门槛限制。
"""
from __future__ import annotations

import time

import pytest

from app import probe, source_gate
from app.probe import PathResult, SourceResult


def _paths(direct=None, mirror=None, proxy=None) -> dict:
    def make(state, speed=None, latency=None, reason=""):
        return PathResult(
            path="",
            state=state,
            latency_ms=latency,
            speed_mbps=speed,
            reason=reason,
            reason_text="",
        )

    out = {}
    for name, spec in (("direct", direct), ("mirror", mirror), ("proxy", proxy)):
        if spec is None:
            out[name] = PathResult(path=name, state="skip", skip="not_configured")
        else:
            state, speed, latency = spec[0], spec[1], spec[2]
            reason = spec[3] if len(spec) > 3 else ""
            out[name] = make(state, speed, latency, reason)
    return out


def _put(source: str, verdict: str, paths: dict) -> None:
    """把一条结论塞进探针缓存（相当于刚探完）。"""
    res = SourceResult(source=source, label=source, verdict=verdict, paths=paths)
    probe._cache[source] = (time.time() + 300, res)


@pytest.fixture(autouse=True)
def _clear_probe_cache():
    probe.invalidate()
    yield
    probe.invalidate()


# ---------------- 四态 ----------------
def test_verdict_ok_when_direct_works():
    res = probe._verdict_for("huggingface", "HF", _paths(("ok", 8.4, 412), ("ok", 1.2, 890), ("ok", 0.6, 1300)))
    assert res.verdict == "ok"


def test_verdict_degraded_when_direct_blocked_but_backup_works():
    paths = _paths(("blocked", None, 5000, "timeout"), None, ("ok", 0.9, 780))
    res = probe._verdict_for("civitai", "Civitai", paths)
    assert res.verdict == "degraded"


def test_verdict_down_when_every_path_fails():
    paths = _paths(("blocked", None, 5000, "timeout"), None, ("blocked", None, 0, "refused"))
    res = probe._verdict_for("github", "GitHub", paths)
    assert res.verdict == "down"


def test_verdict_unknown_when_nothing_measured():
    paths = _paths(("unknown", None, None), None, None)
    res = probe._verdict_for("templates", "templates", paths)
    assert res.verdict == "unknown"


def test_restricted_path_is_degraded_not_down():
    paths = _paths(("ok", 1.0, 100), None, None)
    paths["direct"].restricted = True
    res = probe._verdict_for("civitai", "Civitai", paths)
    assert res.verdict == "degraded"


# ---------------- 20% 代理门槛 ----------------
def test_proxy_needs_20_percent_edge_to_win():
    # 代理只快 10% → 不走代理
    paths = _paths(("ok", 10.0, 100), None, ("ok", 11.0, 120))
    path, _ = probe._auto_path(paths)
    assert path == "direct"


def test_proxy_wins_when_20_percent_faster():
    paths = _paths(("ok", 10.0, 100), None, ("ok", 12.1, 120))
    path, _ = probe._auto_path(paths)
    assert path == "proxy"


def test_proxy_takes_over_when_direct_and_mirror_are_down():
    paths = _paths(("blocked", None, 5000, "timeout"), None, ("ok", 0.9, 780))
    path, _ = probe._auto_path(paths)
    assert path == "proxy"


def test_mirror_wins_when_it_is_the_fastest_usable_path():
    paths = _paths(("ok", 1.0, 100), ("ok", 5.0, 200), None)
    path, _ = probe._auto_path(paths)
    assert path == "mirror"


def test_no_path_when_all_fail():
    paths = _paths(("blocked", None, 1, "timeout"), None, ("blocked", None, 1, "refused"))
    path, _ = probe._auto_path(paths)
    assert path == ""


# ---------------- 门控 ----------------
def _settings(**over) -> dict:
    base = {
        "download": {"path_override": ""},
        "sources": {
            "civitai": {"label": "Civitai", "proxy_enabled": False, "always_enabled": False},
        },
    }
    base.update(over)
    return base


def test_down_source_is_gated():
    _put("civitai", "down", _paths(("blocked", None, 1, "timeout"), None, ("blocked", None, 1, "refused")))
    assert source_gate.is_gated("civitai", _settings()) is True


def test_unknown_source_is_not_gated():
    _put("civitai", "unknown", _paths(("unknown", None, None), None, None))
    assert source_gate.is_gated("civitai", _settings()) is False


def test_always_enabled_escape_hatch_is_not_gated():
    _put("civitai", "down", _paths(("blocked", None, 1, "timeout"), None, ("blocked", None, 1, "refused")))
    settings = _settings()
    settings["sources"]["civitai"]["always_enabled"] = True
    assert source_gate.is_gated("civitai", settings) is False


def test_never_probed_source_is_not_gated():
    assert source_gate.is_gated("civitai", _settings()) is False


# ---------------- 手动指定与回退 ----------------
def test_manual_override_is_not_blocked_by_the_20_percent_edge():
    _put("civitai", "ok", _paths(("ok", 10.0, 100), None, ("ok", 10.5, 110)))
    settings = _settings()
    settings["download"]["path_override"] = "proxy"
    res = probe.cached_result("civitai")
    probe.apply_policy({"civitai": res}, settings)
    assert res.path == "proxy"
    assert res.fallback is False


def test_manual_override_falls_back_when_path_unavailable():
    _put("civitai", "ok", _paths(("ok", 5.0, 100), None, ("blocked", None, 1, "refused")))
    settings = _settings()
    settings["download"]["path_override"] = "proxy"
    res = probe.cached_result("civitai")
    probe.apply_policy({"civitai": res}, settings)
    assert res.path == "direct"
    assert res.fallback is True


# ---------------- 路由配置 ----------------
def test_route_cfg_rewrites_proxy_and_mirror_flags():
    cfg = {"proxy_enabled": True, "use_mirror": False, "mirror": "https://hf-mirror.com"}
    proxy = source_gate.route_cfg(cfg, "huggingface", "proxy")
    assert proxy["_route"] == "proxy"
    assert proxy["proxy_enabled"] is True
    assert proxy["use_mirror"] is False

    mirror = source_gate.route_cfg(cfg, "huggingface", "mirror")
    assert mirror["_route"] == "mirror"
    assert mirror["proxy_enabled"] is False
    assert mirror["use_mirror"] is True

    direct = source_gate.route_cfg(cfg, "huggingface", "direct")
    assert direct["proxy_enabled"] is False
    assert direct["use_mirror"] is False


def test_route_cfg_without_path_keeps_legacy_flags():
    cfg = {"proxy_enabled": True, "use_mirror": False}
    out = source_gate.route_cfg(cfg, "huggingface", "")
    assert "_route" not in out
    assert out["proxy_enabled"] is True


# ---------------- 门控在两条链路上的实际效果 ----------------
def test_search_does_not_send_request_to_gated_source(monkeypatch):
    """被门控的源：发现链路不向它发请求，并把它列进 gated。"""
    from app.api import routes

    _put("civitai", "down", _paths(("blocked", None, 1, "timeout"), None, ("blocked", None, 1, "refused")))
    called: list[str] = []

    class FakeAdapter:
        def search(self, *args, **kwargs):
            called.append(args[0])
            return {"items": [], "total": 0}

    settings = _settings()
    settings["sources"]["civitai"] = {"label": "Civitai", "proxy_enabled": False, "always_enabled": False}
    monkeypatch.setattr(routes, "get_adapter", lambda name: FakeAdapter())
    monkeypatch.setattr(routes, "load_settings", lambda: settings)
    monkeypatch.setattr(routes.cache, "get_search", lambda key: None)
    monkeypatch.setattr(routes.cache, "put_search", lambda key, value: None)

    out = routes.search_models("q", "civitai", "downloads", 5, 1, "")
    assert out["gated"] == ["civitai"]
    assert not called, "被门控的源不该发请求"


def test_download_refuses_gated_source(monkeypatch):
    """被门控的源：下载链路直接拒绝建任务，不发请求。"""
    from app.download import manager as manager_mod
    from app.sources.base import SourceError

    _put("civitai", "down", _paths(("blocked", None, 1, "timeout"), None, ("blocked", None, 1, "refused")))
    settings = _settings()
    settings["sources"]["civitai"] = {"label": "Civitai", "proxy_enabled": False, "always_enabled": False}
    monkeypatch.setattr(manager_mod, "load_settings", lambda: settings)

    with pytest.raises(SourceError) as err:
        manager_mod.manager.create_task("civitai", "123", "", [], "", "", "", "")
    assert "不可用" in str(err.value)


def test_download_uses_probe_path_as_strategy(monkeypatch):
    """探针有结论时，下载任务按它选的那条通路走（而不是旧策略）。"""
    from app.download import manager as manager_mod

    _put("civitai", "ok", _paths(("ok", 5.0, 100), None, ("ok", 9.0, 120)))
    settings = _settings()
    settings["sources"]["civitai"] = {"label": "Civitai", "proxy_enabled": False, "always_enabled": False}
    settings["download"]["strategy"] = "mirror"
    settings["download"]["save_dir"] = "/tmp/simuseor-test-models"
    monkeypatch.setattr(manager_mod, "load_settings", lambda: settings)

    picked: dict = {}

    class FakeAdapter:
        uses_repo_subdir = False

        def resolve(self, repo_id, revision, cfg):
            picked["cfg"] = dict(cfg)
            from app.sources.base import RemoteFile, RepoInfo

            return RepoInfo(
                repo_id=repo_id,
                display_name=repo_id,
                revision="",
                source="civitai",
                files=[RemoteFile(path="m.safetensors", size=10, candidates=["https://civitai.red/m.safetensors"])],
            )

    monkeypatch.setattr(manager_mod, "get_adapter", lambda name: FakeAdapter())
    monkeypatch.setattr(manager_mod, "execute", lambda sql, params=(): "")
    monkeypatch.setattr(manager_mod, "new_id", lambda: "task1")
    monkeypatch.setattr(manager_mod, "now_iso", lambda: "2026-11-22T00:00:00Z")
    monkeypatch.setattr(manager_mod.manager, "_ensure_poller", lambda: None)
    monkeypatch.setattr(manager_mod.manager, "_start_task", lambda *a, **k: None)
    monkeypatch.setattr(manager_mod.manager, "get_task", lambda tid: {"id": tid})

    manager_mod.manager.create_task("civitai", "123", "", ["m.safetensors"], "", "", "", "")
    # 代理比直连快 80% → 自动判定走代理 → 源配置里带上 _route=proxy
    assert picked["cfg"].get("_route") == "proxy"
    assert picked["cfg"].get("proxy_enabled") is True
