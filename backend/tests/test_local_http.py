"""本机进程的 HTTP 调用不能走系统代理。

2026-11-14 真实踩过：开发机设了 HTTP_PROXY，aria2 的 JSON-RPC 请求被代理接走，
拿回空响应 → 轮询线程每秒抛 JSONDecodeError → 所有任务永远停在「下载中 0%」，
而文件其实早就落盘了。同理 ComfyUI 的实例就绪探测也一律判成 starting。
"""
from __future__ import annotations

from app.comfy import runner
from app.download import aria2_client
from app.download.aria2_client import Aria2Client, Aria2Error


class _Resp:
    status_code = 200

    def __init__(self, payload=None, text: str = "") -> None:
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return self._payload


def test_rpc_bypasses_env_proxy(monkeypatch):
    seen: dict = {}

    def fake_post(url, **kwargs):
        seen.update(kwargs)
        seen["url"] = url
        return _Resp({"result": "1.37.0"})

    monkeypatch.setattr(aria2_client.httpx, "post", fake_post)

    assert Aria2Client(6800, "s").rpc("aria2.getVersion") == "1.37.0"
    assert seen["trust_env"] is False
    assert seen["url"] == "http://127.0.0.1:6800/jsonrpc"


def test_rpc_reports_non_json_response(monkeypatch):
    """代理回空 200 时给一句能看懂的错，而不是裸 JSONDecodeError。"""
    monkeypatch.setattr(aria2_client.httpx, "post", lambda url, **kw: _Resp(None))
    try:
        Aria2Client(6800, "").rpc("aria2.getVersion")
    except Aria2Error as exc:
        assert "非 JSON" in str(exc)
    else:  # pragma: no cover - 走到这里说明没抛
        raise AssertionError("应当抛 Aria2Error")


def test_status_probe_bypasses_env_proxy(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        return _Resp({}, text="{}")

    monkeypatch.setattr(runner.httpx, "get", fake_get)
    seen.clear()
    runner._http_ok(8188)
    assert seen["trust_env"] is False
