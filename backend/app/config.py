"""应用配置：全局保存路径 / 代理地址 / 默认策略 + 每源 token 与代理开关。"""
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
    "download": {"save_dir": str(MODELS_DIR), "strategy": "direct"},
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


def load_settings() -> dict:
    for _d in (DATA_DIR, LOG_DIR, TMP_DIR):
        _d.mkdir(parents=True, exist_ok=True)
    data: dict = {}
    if SETTINGS_PATH.exists():
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    merged = copy.deepcopy(DEFAULT_SETTINGS)
    _deep_merge(merged, _migrate(data))
    return merged


def save_settings(settings: dict) -> dict:
    for _d in (DATA_DIR, LOG_DIR, TMP_DIR):
        _d.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(
        json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return settings


def get_web_dist() -> Path | None:
    for candidate in WEB_DIST_CANDIDATES:
        if (candidate / "index.html").exists():
            return candidate
    return None
