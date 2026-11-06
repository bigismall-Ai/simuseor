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
MODELS_DIR = ROOT / "models"
COMFY_DIR = ROOT / "comfy"

SETTINGS_PATH = DATA_DIR / "settings.json"
SECRETS_PATH = DATA_DIR / "secrets.json"
DB_PATH = DATA_DIR / "model_downloader.db"
WEB_DIST_CANDIDATES = [ROOT / "web" / "dist" / "browser", ROOT / "web" / "dist"]

# strategy:
#   sdk    - 走官方下载 SDK（huggingface_hub / modelscope），失败自动回退 aria2 直连
#   direct - aria2 直连下载（默认）
#   proxy  - aria2 + 全局代理（每源可关，代理地址统一在 proxy.url）
#   mirror - 多站点分片：文件按候选站点轮询分配 + aria2 多连接分片，失败自动换站重试
DEFAULT_SETTINGS: dict = {
    "app": {"host": "127.0.0.1", "port": 8000},
    "aria2": {
        "rpc_port": 6800,
        "rpc_secret": "mdl-secret",
        "connections": 8,
        "split": 8,
        "max_concurrent": 3,
    },
    "default_strategy": "direct",
    "download": {"save_dir": "models", "strategy": "direct"},
    "proxy": {"url": "http://127.0.0.1:7890"},
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
    """项目内的绝对路径存为相对路径（可随项目迁移），项目外保持绝对。"""
    if not value:
        return "models"
    try:
        p = Path(value).expanduser()
        if not p.is_absolute():
            p = ROOT / p
        return str(p.resolve().relative_to(ROOT))
    except (ValueError, OSError):
        return str(value)


def _migrate(data: dict) -> dict:
    """旧配置迁移：每源 save_dir/strategy/proxy{enabled,url} -> 顶层 download/proxy + 每源 proxy_enabled。"""
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
    if old_url and not (data.get("proxy") or {}).get("url"):
        data.setdefault("proxy", {})["url"] = old_url
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
    legacy_tokens = _split_tokens(data)
    if had_tokens:
        sec = secrets.setdefault("sources", {})
        for name, token in legacy_tokens.items():
            sec.setdefault(name, {})["token"] = token
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
    _write_json(SECRETS_PATH, secrets)
    _write_json(SETTINGS_PATH, out)
    return settings


def get_web_dist() -> Path | None:
    for candidate in WEB_DIST_CANDIDATES:
        if (candidate / "index.html").exists():
            return candidate
    return None
