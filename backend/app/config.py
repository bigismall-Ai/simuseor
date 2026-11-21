"""应用配置：全局保存路径 / 代理地址 / 默认策略 + 每源代理开关；token 单独存 secrets.json。"""
from __future__ import annotations

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# 按生命周期分层：状态（必须备份）/ 日志 / 临时 / 权重（可重下）/ ComfyUI 运行时（可重建）
VAR_DIR = ROOT / "var"
DATA_DIR = VAR_DIR / "data"
LOG_DIR = VAR_DIR / "logs"
TMP_DIR = VAR_DIR / "tmp"

# workspace/：用户资产。ComfyUI 以它为 --base-directory，所以模型、插件、输入、
# 出图、工作流全在这里；删掉 comfy/ 下的实例不影响这些内容。
WORKSPACE_DIR = ROOT / "workspace"
WORKSPACE_MODELS_DIR = WORKSPACE_DIR / "models"
WORKSPACE_CUSTOM_NODES_DIR = WORKSPACE_DIR / "custom_nodes"
WORKSPACE_INPUT_DIR = WORKSPACE_DIR / "input"
WORKSPACE_OUTPUT_DIR = WORKSPACE_DIR / "output"
WORKSPACE_PREVIEWS_DIR = WORKSPACE_DIR / "previews"
# ComfyUI 的用户目录：--user-directory 指向这里，内部固定是 <用户名>/workflows
WORKSPACE_USERDATA_DIR = WORKSPACE_DIR / "userdata"
WORKSPACE_WORKFLOWS_DIR = WORKSPACE_USERDATA_DIR / "default" / "workflows"

MODELS_DIR = WORKSPACE_MODELS_DIR
# comfy/ 直接放共享基础环境和各实例，不再包一层 instances/
COMFY_DIR = ROOT / "comfy"
# ComfyUI 代码来源：CNB 镜像优先（国内快），GitHub 兜底
COMFY_MIRROR = "https://cnb.cool/bigismall/Comfy-Org/ComfyUI.git"
COMFY_FALLBACK = "https://github.com/Comfy-Org/ComfyUI.git"

# 基础环境（Python + torch + ComfyUI 依赖）：跟硬件走，一台机器装一次，所有实例共享。
# 与实例平级放在 comfy/ 下，点前缀让遍历实例时天然跳过——它不是"一个实例"。
COMFY_ENV_DIR = COMFY_DIR / ".environment"
COMFY_ENV_NAME = "3.13.18"
# python-build-standalone 20261026 构建，已镜像到 CNB（公开仓库，匿名可下载）
COMFY_PYTHON_URLS = {
    ("windows", "x86_64"): "https://cnb.cool/bigismall/Comfy-Org/ComfyUI/-/releases/download/runtime-3.13.18/cpython-3.13.18-win.tar.gz",
    ("linux", "x86_64"): "https://cnb.cool/bigismall/Comfy-Org/ComfyUI/-/releases/download/runtime-3.13.18/cpython-3.13.18-linux.tar.gz",
    ("macos", "arm64"): "https://cnb.cool/bigismall/Comfy-Org/ComfyUI/-/releases/download/runtime-3.13.18/cpython-3.13.18-macos-arm64.tar.gz",
}
COMFY_PYTHON_SHA256 = {
    "cpython-3.13.18-win.tar.gz": "ebe90cc1dce2dd2d7afa1f0aa9b6c269c7c0174aeabdc6a801381602b7283424",
    "cpython-3.13.18-linux.tar.gz": "126343c54daff4068efc1ac269518d0cc202d57857794948103dd1454e8881be",
    "cpython-3.13.18-macos-arm64.tar.gz": "e5af2fde6a937a0e0c795a0c595c4efb70578d57463a2657c819992b9b9acbac",
}

SETTINGS_PATH = DATA_DIR / "settings.json"
SECRETS_PATH = DATA_DIR / "secrets.json"
DB_PATH = DATA_DIR / "model_downloader.db"
WEB_DIST_CANDIDATES = [ROOT / "web" / "dist" / "browser", ROOT / "web" / "dist"]

# strategy:
#   mirror - 镜像优先（默认）：文件按候选站点轮询分配 + aria2 多连接分片，失败换站重试
#   direct - 只用官方地址直连
#   proxy  - 代理优先：只用官方地址，且强制经 proxy.host:port（覆盖每源的 proxy_enabled）
#   sdk    - 走官方下载 SDK（huggingface_hub / modelscope），失败自动回退 aria2 直连
# 镜像 ≠ 代理：镜像是境内直连的另一条通路，套代理会绕回原路（HF 镜像会 308 跳回官方），
# 所以 direct / proxy 两种策略都会**排除镜像地址**。
DEFAULT_SETTINGS: dict = {
    # 0.0.0.0：本机与局域网都可访问；仅本机使用可改回 127.0.0.1
    "app": {"host": "0.0.0.0", "port": 8000},
    "aria2": {
        "rpc_port": 6800,
        "rpc_secret": "mdl-secret",
        "connections": 8,
        "split": 8,
        "max_concurrent": 3,
    },
    "default_strategy": "mirror",
    "download": {"save_dir": "workspace/models", "strategy": "mirror"},
    # ComfyUI 依赖轮子缓存上限（GB）。同一包只留最新版本，总量超出按最久未用淘汰；
    # 0 或负数表示不限制。缓存跟着共享环境 comfy/.environment/cache 走。
    "comfy": {"cache_limit_gb": 4},
    "proxy": {"host": "127.0.0.1", "port": 7890},
    "sources": {
        "huggingface": {
            "label": "Hugging Face",
            "token": "",
            "proxy_enabled": True,
            "mirror": "https://hf-mirror.com",
            "use_mirror": False,
        },
        "modelscope": {
            "label": "ModelScope",
            "token": "",
            "proxy_enabled": False,
            "mirror": "",
            "use_mirror": False,
        },
        "civitai": {
            "label": "Civitai",
            "token": "",
            "proxy_enabled": True,
            "full_catalog": False,
            "mirror": "",
            "use_mirror": False,
        },
        "github": {
            "label": "GitHub",
            "token": "",
            "proxy_enabled": True,
            "mirror": "",
            "use_mirror": False,
        },
        "templates": {
            "label": "ComfyUI 官方模板",
            "token": "",
            "proxy_enabled": False,
            "mirror": "",
            "use_mirror": False,
        },
        # ComfyHub 免鉴权，这里只为让 create_task 能拿到源配置（设置页不展示）
        "comfyhub": {
            "label": "ComfyHub",
            "token": "",
            "proxy_enabled": False,
            "mirror": "",
            "use_mirror": False,
        },
        "demo": {
            "label": "Demo (离线演示)",
            "token": "",
            "proxy_enabled": False,
            "mirror": "",
            "use_mirror": False,
        },
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_save_dir(value: str) -> str:
    """相对路径按项目根解析为绝对路径；绝对路径原样规范化。"""
    p = Path(value or "models").expanduser()
    if not p.is_absolute():
        p = ROOT / p
    return str(p)


def relativize_save_dir(value: str) -> str:
    """项目内的绝对路径存为相对路径（可随项目迁移），项目外保持绝对。

    统一用正斜杠：JSON 里存 `workspace\\models` 只有 Windows 认得，
    项目挪到 macOS / Linux 会变成一个带反斜杠的文件名。
    """
    if not value:
        return "workspace/models"
    try:
        p = Path(value).expanduser()
        if not p.is_absolute():
            p = ROOT / p
        return p.resolve().relative_to(ROOT).as_posix()
    except (ValueError, OSError):
        return str(value)


def build_proxy_url(proxy: dict) -> str:
    """host/port 拼成代理 URL（aria2 / httpx 消费）。host 可自带 scheme。"""
    host = str((proxy or {}).get("host") or "").strip()
    if not host:
        return ""
    if "://" not in host:
        host = "http://" + host
    port = str((proxy or {}).get("port") or "").strip()
    return f"{host}:{port}" if port else host


def source_proxy(cfg: dict | None) -> str | None:
    """该源启用代理时返回代理 URL，否则 None。`cfg` 是 settings['sources'][源名]。

    每源的 `proxy_enabled` 原本只作用于 aria2 下载，搜索 / 解析 / 封面这些元数据请求
    一直是裸请求。TUN 模式下这没暴露问题（系统级接管），但系统代理模式下就割裂了：
    HF 和 Civitai 直连被墙时，**下载能走、搜索不能走** —— 设置页写着「按源控制代理」，
    实际只控制了一半。

    注意：调用方负责在「走镜像」时不要套代理（镜像是国内直连，绕代理会回到
    「镜像看到海外 IP → 308 跳回官方」的老问题）。
    """
    if not (cfg or {}).get("proxy_enabled"):
        return None
    return build_proxy_url(load_settings().get("proxy") or {}) or None


def gh_proxy_prefix() -> str:
    """GitHub 加速前缀（族 1：`{前缀}` + 完整 URL），空串 = 直连。

    现存的公共反代（gh-proxy / ghfast / githubproxy / ghproxy.net）**全是这种写法**，
    实测 4/4 通；同族的「前缀 + 去协议」只有 3/4（githubproxy.cc 会 404），
    「域名替换式」（kkgithub / bgithub）已全部失效。所以这里只支持族 1。

    存的是 `sources.github.mirror`（和 HF 的 mirror 同一个字段位置），
    **填了就生效**，不再额外要求一个开关 —— 反正留空就是不启用。
    """
    cfg = (load_settings().get("sources") or {}).get("github") or {}
    raw = str(cfg.get("mirror") or "").strip()
    if not raw:
        return ""
    if not raw.startswith("http"):
        raw = "https://" + raw
    return raw if raw.endswith("/") else raw + "/"


def gh_url(url: str) -> str:
    """给 GitHub 地址套加速前缀。非 http(s) 地址原样返回（如 demo://）。"""
    if not url.startswith("http"):
        return url
    prefix = gh_proxy_prefix()
    return f"{prefix}{url}" if prefix else url


def gh_proxy(cfg: dict | None) -> str | None:
    """GitHub 请求该走代理吗：填了前缀就不再经代理（前缀本身就是替代通路）。"""
    if gh_proxy_prefix():
        return None
    return source_proxy(cfg)


def split_proxy_url(url: str) -> dict:
    """旧 proxy.url 拆成 {host, port}；非 http 的 scheme 保留在 host 上（socks5:// 等不丢）。"""
    raw = str(url or "").strip()
    if not raw:
        return {}
    head, sep, tail = raw.rpartition(":")
    if sep and tail.strip().isdigit() and "/" not in tail:
        host, port = head, int(tail.strip())
    else:
        host, port = raw, ""
    if host.startswith("http://"):
        host = host[len("http://"):]
    out = {"host": host}
    if port != "":
        out["port"] = port
    return out


def _migrate(data: dict) -> dict:
    """旧配置迁移：每源 save_dir/strategy/proxy{enabled,url} -> 顶层 download/proxy + 每源 proxy_enabled；
    旧 proxy.url 拆成 host/port；旧 proxy 策略并入 direct（代理改由每源 proxy_enabled 控制）。"""
    old_url = ""
    old_dirs: list[str] = []
    for cfg in (data.get("sources") or {}).values():
        if not isinstance(cfg, dict):
            continue
        proxy = cfg.pop("proxy", None)
        if isinstance(proxy, dict):
            cfg.setdefault("proxy_enabled", bool(proxy.get("enabled")))
            old_url = old_url or str(proxy.get("url") or "")
        old_dir = str(cfg.pop("save_dir", "") or "")
        if old_dir:
            old_dirs.append(old_dir)
        cfg.pop("strategy", None)
    download = data.setdefault("download", {})
    if not download.get("strategy") and data.get("default_strategy"):
        download["strategy"] = data["default_strategy"]
    if not download.get("save_dir") and old_dirs:
        parent = str(Path(old_dirs[0]).parent)
        if parent != str(MODELS_DIR):
            download["save_dir"] = parent
    # 模型根从 <项目>/models 迁到 <项目>/workspace/models；旧配置里的相对值
    # 永远是 "models"，绝对路径则单独比对一次，避免落到已废弃的根目录。
    current_dir = str(download.get("save_dir") or "").strip()
    if current_dir in ("", "models"):
        download["save_dir"] = "workspace/models"
    elif current_dir:
        try:
            if Path(current_dir).expanduser().resolve() == (ROOT / "models").resolve():
                download["save_dir"] = "workspace/models"
        except OSError:
            pass
    proxy = data.setdefault("proxy", {})
    if old_url and not proxy.get("host") and not proxy.get("url"):
        proxy.update(split_proxy_url(old_url))
    if proxy.get("url") and not proxy.get("host"):
        proxy.update(split_proxy_url(str(proxy.pop("url"))))
    else:
        proxy.pop("url", None)
    return data


def _split_tokens(settings: dict) -> dict:
    """把 sources.*.token 从 settings 摘出（就地删除），返回 {源名: token}。"""
    tokens: dict[str, str] = {}
    for name, cfg in (settings.get("sources") or {}).items():
        if isinstance(cfg, dict):
            token = str(cfg.pop("token", "") or "")
            if token:
                tokens[name] = token
    return tokens


def load_settings() -> dict:
    for _d in (DATA_DIR, LOG_DIR, TMP_DIR):
        _d.mkdir(parents=True, exist_ok=True)
    data = _read_json(SETTINGS_PATH)
    secrets = _read_json(SECRETS_PATH)

    # 旧版把 token 存在 settings.json：迁出到 secrets.json
    had_tokens = any(
        isinstance(cfg, dict) and "token" in cfg
        for cfg in (data.get("sources") or {}).values()
    )
    had_legacy_proxy = bool((data.get("proxy") or {}).get("url"))
    legacy_tokens = _split_tokens(data)
    if had_tokens or had_legacy_proxy:
        sec = secrets.setdefault("sources", {})
        for name, token in legacy_tokens.items():
            sec.setdefault(name, {})["token"] = token
        _migrate(data)  # 顺手把 proxy.url 拆成 host/port、proxy 策略并入 direct
        # 迁移时顺手把 save_dir 规范成相对形式
        dl = data.setdefault("download", {})
        if dl.get("save_dir"):
            dl["save_dir"] = relativize_save_dir(str(dl["save_dir"]))
        _write_json(SECRETS_PATH, secrets)
        _write_json(SETTINGS_PATH, data)

    merged = copy.deepcopy(DEFAULT_SETTINGS)
    _deep_merge(merged, _migrate(data))
    for name, cfg in (secrets.get("sources") or {}).items():
        if isinstance(cfg, dict) and name in merged["sources"] and cfg.get("token"):
            merged["sources"][name]["token"] = cfg["token"]
    merged["download"]["save_dir"] = resolve_save_dir(merged["download"]["save_dir"])
    return merged


def save_settings(settings: dict) -> dict:
    for _d in (DATA_DIR, LOG_DIR, TMP_DIR):
        _d.mkdir(parents=True, exist_ok=True)
    out = copy.deepcopy(settings)
    # token 只写 secrets.json；settings.json 保持无凭据、可随项目迁移
    secrets = _read_json(SECRETS_PATH)
    sec = secrets.setdefault("sources", {})
    for name, cfg in (out.get("sources") or {}).items():
        if not isinstance(cfg, dict) or "token" not in cfg:
            continue  # 未提交该键：保持 secrets 里已有 token 不变
        token = str(cfg.pop("token") or "")
        if token:
            sec.setdefault(name, {})["token"] = token
        else:
            sec.pop(name, None)  # 显式传空 token 视为清除
    dl = out.setdefault("download", {})
    dl["save_dir"] = relativize_save_dir(str(dl.get("save_dir") or ""))
    # proxy 统一存 host/port（PUT 里带旧 url 字段也拆掉）
    px = out.setdefault("proxy", {})
    if px.get("url") and not px.get("host"):
        px.update(split_proxy_url(str(px.pop("url"))))
    else:
        px.pop("url", None)
    # 设置页不认识 comfy 段（缓存上限等），别让一次保存把它冲回默认值
    if "comfy" not in out:
        kept = _read_json(SETTINGS_PATH).get("comfy")
        if isinstance(kept, dict) and kept:
            out["comfy"] = kept
    _write_json(SECRETS_PATH, secrets)
    _write_json(SETTINGS_PATH, out)
    return settings


def migrate_legacy_comfy_layout() -> list[str]:
    """把早期 comfy/instances/ 里的东西平铺到 comfy/（纯移动，不删任何文件）。

    旧布局 comfy/instances/{.environment, vXXX}，comfy/ 只是个空包装层。
    新布局直接是 comfy/{.environment, vXXX}。同盘 rename 是瞬时操作，内容不变，
    因此已装好的 torch、ComfyUI 代码都可以直接沿用，不需要重新下载。
    目标已存在时跳过，绝不覆盖；空壳目录能删就删，删不掉也不影响迁移结果。
    """
    legacy = COMFY_DIR / "instances"
    if not legacy.is_dir():
        return []
    # 万一真有个实例就叫 instances，别把它当旧容器拆了
    if (legacy / "instance.json").is_file() or (legacy / "ComfyUI").is_dir():
        return []
    moved: list[str] = []
    for child in sorted(legacy.iterdir()):
        dest = COMFY_DIR / child.name
        if dest.exists():
            continue
        child.rename(dest)
        moved.append(child.name)
    try:
        if not any(legacy.iterdir()):
            legacy.rmdir()
    except Exception:  # noqa: BLE001 - 宿主可能拦截删除 API；留个空目录也不影响功能
        pass
    return moved


def ensure_workspace() -> Path:
    """建好 workspace 骨架。

    `--user-directory` 指向的目录必须已存在，否则 ComfyUI 在 argparse 阶段
    直接报错退出（is_valid_directory），所以启动实例前这一步不能省。
    """
    for path in (
        WORKSPACE_DIR,
        WORKSPACE_MODELS_DIR,
        WORKSPACE_CUSTOM_NODES_DIR,
        WORKSPACE_INPUT_DIR,
        WORKSPACE_OUTPUT_DIR,
        WORKSPACE_PREVIEWS_DIR,
        WORKSPACE_USERDATA_DIR,
        WORKSPACE_WORKFLOWS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_DIR


def instance_tmp_dir(name: str) -> Path:
    """实例临时目录（可随时清空）。ComfyUI 会在其下再建一层 temp/。"""
    return TMP_DIR / name


def get_web_dist() -> Path | None:
    for candidate in WEB_DIST_CANDIDATES:
        if (candidate / "index.html").exists():
            return candidate
    return None
