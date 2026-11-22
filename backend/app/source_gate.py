"""门控与选路：把探针结论翻译成「这个源能不能用」「走哪条通路」。

发现（列表）与下载两条链路读**同一份**探针缓存、选**同一条**通路 ——
所以选路逻辑只写在这里一次，两条链路都调它，页面上的读数与实际行为才不会打架。

规矩（规格 §3.1 / §3.6.2 层级三）：
1. **只有 down 才门控**。unknown（没探过 / 探针炸了）不门控。
2. 手动指定（settings.download.path_override）不受 20% 门槛限制；
   但指定的通路对该站不可用时，回退到该站最快的可用通路。
3. 探针只报告，不偷改用户的持久化配置。_route 是运行时标记，不落盘。
"""
from __future__ import annotations

from . import probe
from .config import load_settings


def verdict_for(source: str) -> str:
    """该源当前的探针结论（ok / degraded / down / unknown）。没探过就是 unknown。"""
    res = probe.cached_result(source)
    return res.verdict if res else "unknown"


def is_gated(source: str, settings: dict | None = None) -> bool:
    """这个源现在该不该被门控（发现页不提供入口、下载链路不发请求）。"""
    settings = settings or load_settings()
    res = probe.cached_result(source)
    if res is None or res.verdict != "down":
        return False
    cfg = (settings.get("sources") or {}).get(source) or {}
    # always_enabled 是逃生口：用户显式说了「别管探针」
    return not bool(cfg.get("always_enabled"))


def effective_path(source: str, settings: dict | None = None) -> str:
    """该源当前该走哪条通路（direct / mirror / proxy）。没有结论时返回空串。

    读缓存，不发起探测 —— 探测是设置页的事，后台链路只消费结论。
    """
    settings = settings or load_settings()
    path, _fallback = probe.route_for(source, settings)
    return path


def route_cfg(cfg: dict | None, source: str, path: str) -> dict:
    """把选中的通路写进源配置的副本。

    _route 是运行时标记（不落 settings.json），表达「这一轮走哪条路」：
    由探针结论 + 用户手动指定决定，不是用户自己配的开关。
    """
    out = dict(cfg or {})
    if not path:
        return out
    out["_route"] = path
    if path == "mirror":
        # 镜像是境内直连的另一条通路，套代理会绕回原路（HF 镜像会 308 跳回官方）
        out["proxy_enabled"] = False
        out["use_mirror"] = True
    elif path == "direct":
        out["proxy_enabled"] = False
        out["use_mirror"] = False
    elif path == "proxy":
        out["proxy_enabled"] = True
        out["use_mirror"] = False
    return out


def routed_source_cfg(source: str, settings: dict | None = None) -> dict:
    """该源这一轮实际该用的配置（凭据原样带上，通路按探针结论改写）。"""
    settings = settings or load_settings()
    cfg = (settings.get("sources") or {}).get(source) or {}
    return route_cfg(cfg, source, effective_path(source, settings))


def describe_gate(source: str, settings: dict | None = None) -> str:
    """给界面用的一句话：这个源现在什么状态。"""
    res = probe.cached_result(source)
    if res is None:
        return "还没探过"
    if res.verdict == "down":
        return "三条通路都不通，已被门控"
    if res.verdict == "degraded":
        return res.path_text or "已降级"
    if res.verdict == "ok":
        return res.path_text or "可用"
    return "还没探过"
