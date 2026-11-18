"""下载策略：镜像优先（默认）/ 直连 / 代理优先。

镜像 ≠ 代理，两者是互斥的通路：
- 镜像是境内直连的另一条通路，套代理会被判成海外 IP（HF 镜像会 308 跳回官方）；
- 代理是从本地把流量送出去，选中的必须是官方地址，不能是镜像地址。

所以 direct / proxy 两种策略都会把镜像地址从候选里剔掉。
"""
from __future__ import annotations

from app.download.manager import DownloadManager as Manager

MIRROR_CFG = {"mirror": "https://hf-mirror.com", "proxy_enabled": False}
CANDIDATES = [
    "https://hf-mirror.com/org/repo/resolve/main/a.safetensors",
    "https://huggingface.co/org/repo/resolve/main/a.safetensors",
]


def _mgr() -> Manager:
    # 只测纯函数，绕开 __init__ 里的 aria2 连接
    mgr = Manager.__new__(Manager)
    mgr._host_cursor = 0
    return mgr


def test_mirror_strategy_rotates_between_sites():
    mgr = _mgr()
    picked = {mgr._pick_url(CANDIDATES, "mirror", i, MIRROR_CFG) for i in range(2)}
    assert picked == set(CANDIDATES), "镜像优先要按站点轮询，不能永远选第一个"


def test_direct_and_proxy_skip_mirror():
    mgr = _mgr()
    official = CANDIDATES[1]
    for strategy in ("direct", "proxy"):
        assert mgr._pick_url(CANDIDATES, strategy, 0, MIRROR_CFG) == official


def test_mirror_host_parsing():
    assert Manager._mirror_host({"mirror": "https://hf-mirror.com"}) == "hf-mirror.com"
    assert Manager._mirror_host({"mirror": "https://hf-mirror.com/"}) == "hf-mirror.com"
    assert Manager._mirror_host({"mirror": ""}) == ""
    assert Manager._mirror_host(None) == ""


def test_wants_proxy_rules():
    # 代理优先：覆盖每源开关
    assert Manager._wants_proxy("proxy", {"proxy_enabled": False}) is True
    # 其余策略仍看每源开关
    assert Manager._wants_proxy("mirror", {"proxy_enabled": True}) is True
    assert Manager._wants_proxy("mirror", {"proxy_enabled": False}) is False
    assert Manager._wants_proxy("direct", None) is False


def test_single_candidate_falls_back_to_it():
    """没有镜像候选时，三种策略都只能用这一个地址。"""
    mgr = _mgr()
    only = ["https://huggingface.co/org/repo/resolve/main/a.bin"]
    for strategy in ("mirror", "direct", "proxy"):
        assert mgr._pick_url(only, strategy, 0, {}) == only[0]
