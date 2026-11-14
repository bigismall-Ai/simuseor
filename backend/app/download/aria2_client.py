"""aria2c RPC 客户端：自动拉起 aria2c 守护进程并封装 JSON-RPC。"""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import httpx

from ..config import LOG_DIR


class Aria2Error(Exception):
    pass


class Aria2Client:
    def __init__(self, rpc_port: int = 6800, secret: str = "", max_concurrent: int = 3):
        self.port = rpc_port
        self.secret = secret
        self.max_concurrent = max_concurrent
        self._proc: subprocess.Popen | None = None

    @property
    def endpoint(self) -> str:
        return f"http://127.0.0.1:{self.port}/jsonrpc"

    def rpc(self, method: str, params: list | None = None, timeout: float = 10.0):
        rpc_params: list = []
        if self.secret:
            rpc_params.append(f"token:{self.secret}")
        rpc_params.extend(params or [])
        payload = {"jsonrpc": "2.0", "id": "model-downloader", "method": method, "params": rpc_params}
        try:
            # trust_env=False：本机 RPC 绝不能走 HTTP_PROXY。开发机的代理环境变量
            # 会让请求被代理接走，拿到空响应的 JSONDecodeError，然后所有任务卡在
            # 「下载中 0%」而 aria2 其实压根没收到活儿。
            resp = httpx.post(self.endpoint, json=payload, timeout=timeout, trust_env=False)
        except httpx.HTTPError as exc:
            raise Aria2Error(f"aria2 RPC 调用失败: {exc}") from exc
        try:
            data = resp.json()
        except ValueError as exc:
            raise Aria2Error(f"aria2 RPC 返回了非 JSON 响应（端口 {self.port} 被别的服务占用？）") from exc
        if "error" in data:
            raise Aria2Error(f"aria2 错误: {data['error']}")
        return data.get("result")

    def is_alive(self) -> bool:
        try:
            self.rpc("aria2.getVersion", timeout=2.0)
            return True
        except Exception:
            return False

    def ensure_running(self) -> None:
        if self.is_alive():
            return
        log_dir = LOG_DIR
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "aria2d.log"
        cmd = [
            "aria2c",
            "--enable-rpc",
            f"--rpc-listen-port={self.port}",
            "--rpc-allow-origin-all",
            f"--max-concurrent-downloads={self.max_concurrent}",
            "--continue=true",
            "--auto-file-renaming=false",
            "--allow-overwrite=false",
            "--file-allocation=none",
            "--console-log-level=warn",
            "--summary-interval=0",
            f"--stop-with-process={os.getpid()}",
        ]
        if self.secret:
            cmd.append(f"--rpc-secret={self.secret}")
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with open(log_path, "a", encoding="utf-8") as log:
            self._proc = subprocess.Popen(
                cmd,
                stdout=log,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
        for _ in range(30):
            if self.is_alive():
                return
            time.sleep(0.2)
        raise Aria2Error(f"aria2c 启动失败，请检查 aria2 是否已安装（日志: {log_path}）")

    def add_uri(self, uris: list[str], options: dict) -> str:
        self.ensure_running()
        return self.rpc("aria2.addUri", [uris, options])

    def tell_status(self, gid: str) -> dict:
        keys = ["gid", "status", "totalLength", "completedLength", "downloadSpeed", "errorCode", "files"]
        return self.rpc("aria2.tellStatus", [gid, keys]) or {}

    def pause(self, gid: str) -> None:
        self.rpc("aria2.pause", [gid])

    def unpause(self, gid: str) -> None:
        self.rpc("aria2.unpause", [gid])

    def remove(self, gid: str) -> None:
        try:
            self.rpc("aria2.remove", [gid])
        except Aria2Error:
            try:
                self.rpc("aria2.forceRemove", [gid])
            except Aria2Error:
                pass

    def shutdown(self) -> None:
        if self._proc and self._proc.poll() is None:
            try:
                self.rpc("aria2.shutdown")
            except Aria2Error:
                self._proc.kill()
