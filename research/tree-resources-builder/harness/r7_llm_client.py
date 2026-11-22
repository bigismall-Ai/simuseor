# R7 云端 LLM 客户端：从本机既有 provider 配置取凭据，只走云端 API。
#
# 为什么要有这层
# --------------
# R7 的验收口径是「云端 LLM 出 JSON 配方 → 本地确定性执行 → 校验器判定 →
# 结构化 hint → 修复」。配方必须**真的**由云端模型写出来，所以需要一个只负责
# 搬请求的薄客户端：读配置 → 拼请求 → 收响应 → 记一笔非敏感账。
#
# 纪律（PLAN.md C1–C5）
# --------------------
# * 凭据只进内存：不打印、不写仓库、不写读数文件（落盘前统一 redact）；
# * 只调云端 API：本机不推理、不加载模型、不下载任何权重；
# * 每次调用留痕：provider / 模型名 / 协议 / token 用量 / 耗时 / HTTP 状态。
#
# provider 来源
# -------------
# * ~/.minimax/config.yaml 的 `provider:` 段（npm 字段决定协议）；
# * 同文件 `custom_provider:` 段（api 字段决定协议，支持 openai-completions）；
# * 路径可用环境变量 R7_LLM_CONFIG / MINIMAX_DATA_DIR 覆盖。
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx

DEFAULT_TIMEOUT = 120.0
MAX_ATTEMPTS = 3
RETRY_SLEEP = (1.5, 4.0)

#: npm 包名 / api 字段 → 线上协议
PROTOCOL_BY_NPM = {
    "@ai-sdk/anthropic": "anthropic",
    "@ai-sdk/openai": "chat-completions",
    "@ai-sdk/google": "gemini",
}
PROTOCOL_BY_API = {
    "anthropic": "anthropic",
    "anthropic-messages": "anthropic",
    "openai-completions": "chat-completions",
    "openai-responses": "chat-completions",
    "google": "gemini",
}


class LlmError(RuntimeError):
    """带明确原因的错误（凭据缺失 / 端点不可达 / HTTP 失败 / 响应不合法）。"""


# ------------------------------------------------------------------ 配置

def default_config_path() -> Path:
    env = os.environ.get("R7_LLM_CONFIG")
    if env:
        return Path(env).expanduser()
    data_dir = os.environ.get("MINIMAX_DATA_DIR") or os.environ.get("__MAVIS_PARENT_DATA_DIR")
    if data_dir:
        return Path(data_dir).expanduser() / "config.yaml"
    return Path.home() / ".minimax" / "config.yaml"


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path) if path else default_config_path()
    if not p.exists():
        raise LlmError("找不到 provider 配置：%s（可用 R7_LLM_CONFIG 指定路径）" % p)
    import yaml

    with open(p) as fh:
        cfg = yaml.safe_load(fh)
    if not isinstance(cfg, dict):
        raise LlmError("provider 配置格式不对：%s" % p)
    return cfg


def _models_of(pconf: dict[str, Any]) -> dict[str, Any]:
    models = pconf.get("models")
    if isinstance(models, dict):
        return models
    single = pconf.get("model")
    if isinstance(single, dict):
        return single
    return {}


def collect_providers(cfg: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """把 `provider:` 与 `custom_provider:` 两段合成一张表。"""
    out: dict[str, dict[str, Any]] = {}
    for pid, pconf in (cfg.get("provider") or {}).items():
        if not isinstance(pconf, dict):
            continue
        proto = PROTOCOL_BY_NPM.get(str(pconf.get("npm", "")), "chat-completions")
        out[pid] = {"protocol": proto, "options": dict(pconf.get("options") or {}),
                    "models": _models_of(pconf), "source": "provider"}
    for pid, pconf in (cfg.get("custom_provider") or {}).items():
        if not isinstance(pconf, dict):
            continue
        proto = PROTOCOL_BY_API.get(str(pconf.get("api", "")), "chat-completions")
        out[pid] = {"protocol": proto, "options": dict(pconf.get("options") or {}),
                    "models": _models_of(pconf), "source": "custom_provider"}
    return out


def redact(text: str, secrets) -> str:
    """把凭据字面量从任意文本里抹掉（落盘前的最后一道闸）。"""
    if not text:
        return text
    for s in secrets:
        if s and len(str(s)) >= 4 and str(s) in text:
            text = text.replace(str(s), "<redacted>")
    return text


# ------------------------------------------------------------------ 客户端

class LlmClient:
    def __init__(self, config_path: str | Path | None = None,
                 timeout: float = DEFAULT_TIMEOUT):
        self.config_path = Path(config_path) if config_path else default_config_path()
        self.config = load_config(self.config_path)
        self.providers = collect_providers(self.config)
        self.timeout = timeout
        self._secrets = set()
        for pconf in self.providers.values():
            key = (pconf.get("options") or {}).get("apiKey")
            if key:
                self._secrets.add(str(key))

    # ---------------- 目录

    def list_models(self) -> list[dict[str, Any]]:
        out = []
        for pid, pconf in sorted(self.providers.items()):
            for mid, mconf in sorted(pconf["models"].items()):
                out.append({
                    "ref": "%s/%s" % (pid, mid),
                    "provider": pid,
                    "model": mid,
                    "protocol": pconf["protocol"],
                    "source": pconf["source"],
                    "name": (mconf or {}).get("name") if isinstance(mconf, dict) else None,
                })
        return out

    def resolve(self, model_ref: str) -> tuple[dict[str, Any], str, dict[str, Any]]:
        if "/" not in model_ref:
            raise LlmError("模型引用要写成 provider/model，得到 %r" % model_ref)
        pid, mid = model_ref.split("/", 1)
        pconf = self.providers.get(pid)
        if pconf is None:
            raise LlmError("配置里没有 provider %r（可用 provider: %s）"
                           % (pid, ", ".join(sorted(self.providers)) or "无"))
        if mid not in pconf["models"]:
            raise LlmError("provider %r 里没有模型 %r（可用 %s）"
                           % (pid, mid, ", ".join(sorted(pconf["models"])) or "无"))
        return pconf, mid, pconf["models"][mid] or {}

    def credential_status(self, model_ref: str) -> dict[str, Any]:
        """只报「有没有可用凭据」，绝不回显凭据本身。"""
        try:
            pconf, mid, _ = self.resolve(model_ref)
        except LlmError as exc:
            return {"ok": False, "reason": str(exc)}
        opts = pconf.get("options") or {}
        key = str(opts.get("apiKey") or "")
        base = str(opts.get("baseURL") or "")
        placeholder = key.lower() in ("sk-xxx", "xxxxxx", "changeme", "secret", "token")
        return {
            "ok": bool(key) and not placeholder and bool(base),
            "provider": model_ref.split("/", 1)[0],
            "model": mid,
            "protocol": pconf["protocol"],
            "base_host": base.split("//", 1)[-1].split("/", 1)[0],
            "api_key_present": bool(key),
            "api_key_placeholder": placeholder,
            "reason": "" if key and not placeholder else "apiKey 是占位符，需要真凭据",
        }

    # ---------------- 调用

    def call(self, model_ref: str, system: str, prompt: str, *,
             max_tokens: int = 2048, temperature: float | None = 0.2,
             timeout: float | None = None) -> dict[str, Any]:
        """调一次云端 API。永远返回 dict，不抛异常（错误写进 error 字段）。"""
        started = time.time()
        try:
            pconf, model_id, mconf = self.resolve(model_ref)
        except LlmError as exc:
            return self._fail(model_ref, "", str(exc), started, 0)

        opts = pconf.get("options") or {}
        base = str(opts.get("baseURL") or "").rstrip("/")
        api_key = str(opts.get("apiKey") or "")
        if not base:
            return self._fail(model_ref, model_id, "provider 没有 baseURL", started, 0)
        if not api_key or api_key.lower() in ("sk-xxx", "xxxxxx", "changeme", "secret", "token"):
            return self._fail(model_ref, model_id,
                              "provider %s 没有可用凭据（apiKey 是占位符）"
                              % model_ref.split("/", 1)[0], started, 0)

        protocol = pconf["protocol"]
        headers = {"Content-Type": "application/json"}
        extra = dict(opts.get("headers") or {})
        if isinstance(mconf, dict):
            extra.update(mconf.get("headers") or {})
        if protocol == "anthropic":
            headers["x-api-key"] = api_key
        else:
            headers["Authorization"] = "Bearer %s" % api_key
        headers.update(extra)

        messages = ([{"role": "system", "content": system}] if system else []) + \
                   [{"role": "user", "content": prompt}]
        body = self._build_body(protocol, model_id, messages, max_tokens, temperature, mconf)
        url = self._build_url(protocol, base, model_id)

        attempts = 0
        last_status = None
        last_error = ""
        while attempts < MAX_ATTEMPTS:
            attempts += 1
            try:
                with httpx.Client(timeout=timeout or self.timeout) as client:
                    resp = client.post(url, headers=headers, json=body)
                last_status = resp.status_code
                if resp.status_code == 200:
                    try:
                        data = resp.json()
                    except Exception:
                        return self._fail(model_ref, model_id, "响应不是合法 JSON",
                                          started, attempts, last_status)
                    text = self._extract_text(protocol, data)
                    usage = self._extract_usage(protocol, data)
                    if not text.strip() and attempts < MAX_ATTEMPTS:
                        # 推理模型可能把 token 全花在 reasoning 上、正文为空：
                        # 记一笔重试（不是配方不通过，而是这次调用没拿到内容）
                        last_error = "响应正文为空（token 可能被 reasoning 吃光）"
                        time.sleep(RETRY_SLEEP[min(attempts - 1, len(RETRY_SLEEP) - 1)])
                        continue
                    return {
                        "ok": True,
                        "provider": model_ref.split("/", 1)[0],
                        "model": str(data.get("model") or model_id),
                        "protocol": protocol,
                        "text": text,
                        "usage": usage,
                        "http_status": last_status,
                        "attempts": attempts,
                        "latency_ms": int((time.time() - started) * 1000),
                        "error": "",
                    }
                last_error = "HTTP %d %s" % (last_status, resp.text[:200])
                # openai-completions 的 baseURL 少了 /v1 时会 404，补一次再试
                if last_status == 404 and protocol == "chat-completions" \
                        and not base.endswith("/v1"):
                    base = base + "/v1"
                    url = self._build_url(protocol, base, model_id)
                    continue
                if last_status in (429, 500, 502, 503, 504) and attempts < MAX_ATTEMPTS:
                    time.sleep(RETRY_SLEEP[min(attempts - 1, len(RETRY_SLEEP) - 1)])
                    continue
                break
            except Exception as exc:  # 网络层失败：重试到上限
                last_error = "%s: %s" % (type(exc).__name__, str(exc)[:180])
                if attempts < MAX_ATTEMPTS:
                    time.sleep(RETRY_SLEEP[min(attempts - 1, len(RETRY_SLEEP) - 1)])
                    continue
                break
        return self._fail(model_ref, model_id, last_error or "调用失败",
                          started, attempts, last_status)

    # ---------------- 协议细节

    @staticmethod
    def _build_body(protocol, model_id, messages, max_tokens, temperature, mconf):
        body: dict[str, Any] = {"model": model_id, "max_tokens": max_tokens}
        if protocol == "anthropic":
            sys_parts = [m["content"] for m in messages if m["role"] == "system"]
            body["messages"] = [m for m in messages if m["role"] != "system"]
            if sys_parts:
                body["system"] = "\n\n".join(sys_parts)
        elif protocol == "gemini":
            sys_parts = [m["content"] for m in messages if m["role"] == "system"]
            contents = [{"role": "model" if m["role"] == "assistant" else "user",
                         "parts": [{"text": m["content"]}]}
                        for m in messages if m["role"] != "system"]
            body = {"contents": contents,
                    "generationConfig": {"maxOutputTokens": max_tokens}}
            if sys_parts:
                body["systemInstruction"] = {"parts": [{"text": "\n\n".join(sys_parts)}]}
        else:
            body["messages"] = messages
        if temperature is not None:
            if protocol == "gemini":
                body["generationConfig"]["temperature"] = temperature
            else:
                body["temperature"] = temperature
        if isinstance(mconf, dict):
            opts = mconf.get("options") or {}
            for k in ("store", "effort", "reasoningSummary"):
                if k in opts:
                    body[k] = opts[k]
        return body

    @staticmethod
    def _build_url(protocol, base, model_id):
        if protocol == "anthropic":
            return "%s/messages" % base
        if protocol == "gemini":
            return "%s/models/%s:generateContent" % (base, model_id)
        return "%s/chat/completions" % base

    @staticmethod
    def _extract_text(protocol, data):
        if protocol == "anthropic":
            for blk in data.get("content", []) or []:
                if blk.get("type") == "text":
                    return blk.get("text", "")
            return ""
        if protocol == "gemini":
            cands = data.get("candidates", []) or []
            if cands:
                parts = cands[0].get("content", {}).get("parts", []) or []
                return "".join(p.get("text", "") for p in parts)
            return ""
        choices = data.get("choices", []) or []
        if choices:
            return (choices[0].get("message", {}) or {}).get("content", "") or ""
        return ""

    @staticmethod
    def _extract_usage(protocol, data):
        u = data.get("usage") or data.get("usageMetadata") or {}
        if protocol == "anthropic":
            p = u.get("input_tokens", 0)
            c = u.get("output_tokens", 0)
        elif protocol == "gemini":
            p = u.get("promptTokenCount", 0)
            c = u.get("candidatesTokenCount", 0)
        else:
            p = u.get("prompt_tokens", 0)
            c = u.get("completion_tokens", 0)
        return {"prompt_tokens": int(p or 0),
                "completion_tokens": int(c or 0),
                "total_tokens": int(u.get("total_tokens") or ((p or 0) + (c or 0)))}

    def _fail(self, model_ref, model_id, error, started, attempts, status=None):
        return {
            "ok": False,
            "provider": model_ref.split("/", 1)[0] if "/" in model_ref else "",
            "model": model_id,
            "protocol": "",
            "text": "",
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "http_status": status,
            "attempts": attempts,
            "latency_ms": int((time.time() - started) * 1000),
            "error": redact(str(error), self._secrets),
        }

    def scrub(self, text: str) -> str:
        return redact(text, self._secrets)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="R7 云端 LLM 连通性自检（不打印凭据）")
    ap.add_argument("--model", default="minimax-direct/MiniMax-M3.1-Flash")
    ap.add_argument("--ping", action="store_true", help="发一条 16 token 的最小请求")
    args = ap.parse_args()

    cli = LlmClient()
    print("config:", cli.config_path)
    print("models:")
    for m in cli.list_models():
        print("  %-46s %-18s %s" % (m["ref"], m["protocol"], m["source"]))
    st = cli.credential_status(args.model)
    print("credential:", json.dumps(st, ensure_ascii=False))
    if args.ping:
        res = cli.call(args.model, "你只回一个字。", "回一个字：好", max_tokens=16)
        res.pop("text", None)
        print("ping:", json.dumps(res, ensure_ascii=False))
