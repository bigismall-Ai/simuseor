"""下载管理器：任务生命周期、三种策略（sdk/direct/mirror）、进度轮询、完成后入库。"""
from __future__ import annotations

import json
import struct
import threading
import time
from pathlib import Path

from ..comfy.model_dirs import normalize_folder, plan_folders
from ..config import (
    WORKSPACE_WORKFLOWS_DIR,
    build_proxy_url,
    load_settings,
    resolve_save_dir,
)
from ..db import execute, new_id, now_iso, query
from ..sources import get_adapter
from ..sources.base import SourceError
from .aria2_client import Aria2Client, Aria2Error

TERMINAL = {"completed", "failed", "canceled"}


def _demo_safetensors_header() -> bytes:
    """造一段合法的 safetensors 头（载荷是假的，格式是真的）。

    格式：前 8 字节 = 头部长度（小端 u64），紧跟一段 JSON 头。
    JSON 头形如 {"tensor.name": {"dtype": "F16", "shape": [n, m], "data_offsets": [a, b]}, ...}
    长度字段必须与 JSON 的实际字节数一致，否则解析器会读到错位。

    头部里带上 __metadata__ 的 demo 标记：模型库据此把这条标成「演示数据」，
    不会让用户以为磁盘上那个 3 MB 的东西是真能跑的权重。
    """
    meta = {
        "__metadata__": {
            "demo": "true",
            "demo_note": "离线演示占位文件，权重内容为假",
            "format": "pt",
        }
    }
    # 两个假张量：形状能算出参数量，dtype 决定精度档位
    tensors = {
        "demo.embed.weight": {"dtype": "F16", "shape": [512, 512], "data_offsets": [0, 524288]},
        "demo.output.weight": {"dtype": "F16", "shape": [512, 512], "data_offsets": [524288, 1048576]},
    }
    header = dict(meta)
    header.update(tensors)
    blob = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # safetensors 规范要求 JSON 头以空格补齐到 8 字节倍数
    pad = (8 - len(blob) % 8) % 8
    blob += b" " * pad
    return struct.pack("<Q", len(blob)) + blob


def _is_workflow_target(target: str | Path) -> bool:
    """目标目录是否落在共享工作流库下。

    工作流不是权重：它有自己的收尾逻辑（解 zip），也不该进本地模型库。
    """
    try:
        Path(target).resolve().relative_to(WORKSPACE_WORKFLOWS_DIR.resolve())
    except (ValueError, OSError):
        return False
    return True


def _task_kind(target: str | Path) -> str:
    """这条任务下的是什么：工作流包，还是模型权重。

    两条链路共用 aria2 与同一张 tasks 表，只是落点不同；下载任务页得能标出来，
    否则一屏任务长得一模一样，看不出「工作流其实也走了下载任务」。
    """
    return "workflow" if _is_workflow_target(target) else "model"


class DownloadManager:
    def __init__(self) -> None:
        self._aria2: Aria2Client | None = None
        self._poller_started = False
        self._pause_events: dict[str, threading.Event] = {}
        self._canceled: set[str] = set()
        self._host_cursor = 0

    # ---------------- aria2 懒加载 ----------------
    def _client(self) -> Aria2Client:
        if self._aria2 is None:
            cfg = load_settings()["aria2"]
            self._aria2 = Aria2Client(
                int(cfg.get("rpc_port", 6800)),
                str(cfg.get("rpc_secret", "")),
                int(cfg.get("max_concurrent", 3)),
            )
        return self._aria2

    def _ensure_poller(self) -> None:
        if not self._poller_started:
            self._poller_started = True
            threading.Thread(target=self._poll_loop, daemon=True).start()

    # ---------------- 任务创建 ----------------
    def create_task(
        self,
        source: str,
        repo_id: str,
        revision: str,
        file_paths: list[str],
        strategy: str = "",
        save_dir: str = "",
        target_folder: str = "",
        task: str = "",
    ) -> dict:
        settings = load_settings()
        src_cfg = settings["sources"].get(source)
        if not src_cfg:
            raise SourceError(f"未配置的下载源: {source}")
        adapter = get_adapter(source)
        repo = adapter.resolve(repo_id, revision or "", src_cfg)
        selected = {p for p in file_paths if p}
        files = [f for f in repo.files if not selected or f.path in selected]
        if not files:
            raise SourceError("没有选中任何文件")

        strategy = (strategy or settings["download"].get("strategy") or settings.get("default_strategy") or "direct").lower()
        base_dir = Path(resolve_save_dir(save_dir)) if save_dir else Path(settings["download"]["save_dir"])
        # 统一落到 ComfyUI 目录结构（checkpoints/loras/...），不再按来源分目录。
        # 分体仓库（Flux / SD3）的 transformer、text_encoder、vae 属于不同目录，
        # 所以**按文件**定目录；显式指定 target_folder 时整条任务都用它。
        plan = plan_folders([f.path for f in files])
        override = normalize_folder(target_folder)
        if override:
            plan = {p: override for p in plan}
        repo_dir = repo.display_name.replace("/", "--")

        file_dirs: dict[str, Path] = {}
        for f in files:
            folder = plan[f.path]
            if folder == "workflows":
                # 工作流不是 ComfyUI 的模型类型：落到共享工作流目录，所有实例共用一份，
                # 不再混在 models/ 下（ComfyUI 也不把 workflows 当模型目录扫描）
                dest = WORKSPACE_WORKFLOWS_DIR / repo_dir
            else:
                dest = base_dir / folder
                if adapter.uses_repo_subdir:
                    dest = dest / repo_dir
            dest.mkdir(parents=True, exist_ok=True)
            file_dirs[f.path] = dest

        dirs = {str(d) for d in file_dirs.values()}
        # task.target_dir 只作「单目录任务的落点」；混装任务记保存根目录，
        # 真实落点看每个文件的 target_dir。
        target = Path(next(iter(dirs))) if len(dirs) == 1 else base_dir

        task_id = new_id()
        ts = now_iso()
        total = sum(f.size for f in files)
        execute(
            "INSERT INTO tasks (id, source, repo_id, revision, strategy, save_dir, target_dir, status, total_bytes, done_bytes, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (task_id, source, repo.repo_id, repo.revision, strategy, str(base_dir), str(target), "pending", total, 0, ts, ts),
        )
        for f in files:
            execute(
                "INSERT INTO task_files (id, task_id, path, size, done_bytes, status, candidates, folder, target_dir)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    new_id(),
                    task_id,
                    f.path,
                    f.size,
                    0,
                    "queued",
                    json.dumps(f.candidates, ensure_ascii=False),
                    plan[f.path],
                    str(file_dirs[f.path]),
                ),
            )
        self._ensure_poller()
        threading.Thread(target=self._start_task, args=(task_id, repo.repo_id, repo.revision), daemon=True).start()
        return self.get_task(task_id)

    @staticmethod
    def _row_dir(row: dict, fallback: Path) -> Path:
        """该文件自己的落盘目录；老任务没有这个字段就退回任务级目录。"""
        raw = (row.get("target_dir") or "").strip()
        return Path(raw) if raw else fallback

    # ---------------- 启动下载 ----------------
    def _start_task(self, task_id: str, repo_id: str, revision: str) -> None:
        task = self._task_row(task_id)
        if not task or task["status"] in TERMINAL:
            return
        execute("UPDATE tasks SET status='downloading', updated_at=? WHERE id=?", (now_iso(), task_id))
        src_cfg = load_settings()["sources"].get(task["source"], {})
        adapter = get_adapter(task["source"])
        target = Path(task["target_dir"])
        rows = query("SELECT * FROM task_files WHERE task_id=? AND status IN ('queued','active')", (task_id,))

        if task["source"] == "demo":
            for row in rows:
                threading.Thread(
                    target=self._demo_file, args=(task_id, row, self._row_dir(row, target)), daemon=True
                ).start()
            return

        if task["strategy"] == "sdk" and adapter.supports_sdk():
            threading.Thread(target=self._sdk_download, args=(task_id, repo_id, revision, rows, target, src_cfg), daemon=True).start()
            return

        for index, row in enumerate(rows):
            threading.Thread(target=self._aria2_file, args=(task_id, row, target, task["strategy"], src_cfg, index), daemon=True).start()

    # ---------------- 策略实现 ----------------
    def _pick_url(self, candidates: list[str], strategy: str, index: int) -> str:
        if not candidates:
            return ""
        if strategy == "mirror" and len(candidates) > 1:
            hosts: dict[str, list[str]] = {}
            for url in candidates:
                host = url.split("/")[2] if "://" in url else url
                hosts.setdefault(host, []).append(url)
            keys = list(hosts.keys())
            picked = keys[index % len(keys)] if keys else ""
            self._host_cursor += 1
            return hosts[picked][0] if picked else candidates[0]
        return candidates[0]

    def _aria2_file(self, task_id: str, row: dict, target: Path, strategy: str, src_cfg: dict, index: int) -> None:
        if task_id in self._canceled:
            return
        candidates = json.loads(row.get("candidates") or "[]")
        url = self._pick_url(candidates, strategy, index)
        if not url:
            execute("UPDATE task_files SET status='failed', error='无可用下载地址' WHERE id=?", (row["id"],))
            return
        try:
            client = self._client()
            settings = load_settings()
            aria_cfg = settings["aria2"]
            options = {
                "dir": str(target),
                "out": row["path"],
                "continue": "true",
                "file-allocation": "none",
                "max-connection-per-server": str(int(aria_cfg.get("connections", 8))),
                "split": str(int(aria_cfg.get("split", 8))),
            }
            proxy_url = build_proxy_url(settings.get("proxy") or {})
            if (src_cfg or {}).get("proxy_enabled") and proxy_url:
                options["http-proxy"] = proxy_url
                options["https-proxy"] = proxy_url
            token = (src_cfg or {}).get("token") or ""
            if token and not url.startswith("demo://") and "token=" not in url:
                options["header"] = [f"Authorization: Bearer {token}"]
            gid = client.add_uri([url], options)
            execute(
                "UPDATE task_files SET status='active', gid=?, url=?, error=NULL WHERE id=?",
                (gid, url, row["id"]),
            )
        except (Aria2Error, Exception) as exc:  # noqa: BLE001
            self._fallback_or_fail(task_id, row, candidates, target, strategy, src_cfg, index, str(exc))

    def _fallback_or_fail(self, task_id, row, candidates, target, strategy, src_cfg, index, error):
        """当前 URL 失败时尝试候选里的下一个站点（多站点回退）。"""
        current = row.get("url") or ""
        rest = [u for u in candidates if u != current]
        if rest:
            new_row = dict(row)
            new_row["candidates"] = json.dumps(rest)
            execute("UPDATE task_files SET candidates=?, error=? WHERE id=?", (json.dumps(rest), error, row["id"]))
            self._aria2_file(task_id, new_row, target, strategy, src_cfg, index)
        else:
            execute("UPDATE task_files SET status='failed', error=? WHERE id=?", (error[:500], row["id"]))

    def _sdk_download(self, task_id, repo_id, revision, rows, target: Path, src_cfg: dict) -> None:
        adapter = get_adapter(self._task_row(task_id)["source"])
        # 分体仓库的文件分属不同目录，SDK 只能逐个目录调用（它按 local_dir 落盘）
        groups: dict[Path, list[dict]] = {}
        for row in rows:
            groups.setdefault(self._row_dir(row, target), []).append(row)
        try:
            for dest, group in groups.items():

                def on_done(path: str, group=group) -> None:
                    for row in group:
                        if row["path"] == path:
                            execute(
                                "UPDATE task_files SET status='completed', done_bytes=size WHERE id=?",
                                (row["id"],),
                            )

                adapter.sdk_download(
                    repo_id, revision, [r["path"] for r in group], dest, src_cfg, on_file_done=on_done
                )
                for row in group:
                    execute("UPDATE task_files SET status='completed', done_bytes=size WHERE id=?", (row["id"],))
        except Exception as exc:  # noqa: BLE001
            # SDK 失败自动回退 aria2 直连（Rodel 式稳态）
            for index, row in enumerate(rows):
                done = query("SELECT status FROM task_files WHERE id=?", (row["id"],))
                if done and done[0]["status"] == "completed":
                    continue
                threading.Thread(
                    target=self._aria2_file,
                    args=(task_id, row, self._row_dir(row, target), "direct", src_cfg, index),
                    daemon=True,
                ).start()

    def _demo_file(self, task_id: str, row: dict, target: Path) -> None:
        """生成 demo 占位文件。

        .safetensors 要写出**合法的头部**：前 8 字节是头长度（小端 u64），
        紧跟一段 JSON 头，声明每个张量的 dtype 与 shape。
        全填 ASCII '0' 的话，8 个 '0' 会被读成 3.4 EB 的头长度，
        任何 safetensors 解析器都会崩（MemoryError）。

        头部之后用 0 填充 —— 载荷是假的，但**格式是真的**，
        这样下游（模型库读精度、算参数量）能完整走通。
        """
        fid = row["id"]
        size = int(row["size"])
        event = threading.Event()
        event.set()
        self._pause_events[fid] = event
        path = target / row["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        written = int(row["done_bytes"] or 0)
        with open(path, "ab" if written else "wb") as fh:
            if not written and path.suffix == ".safetensors":
                prefix = _demo_safetensors_header()
                fh.write(prefix)
                written = len(prefix)
            while written < size:
                if task_id in self._canceled:
                    execute("UPDATE task_files SET status='canceled' WHERE id=?", (fid,))
                    return
                if not event.is_set():
                    time.sleep(0.1)
                    continue
                chunk = min(65536, size - written)
                fh.write(b"0" * chunk)
                written += chunk
                if written % 262144 < 65536 or written >= size:
                    execute("UPDATE task_files SET done_bytes=? WHERE id=?", (written, fid))
                time.sleep(0.03)
        execute("UPDATE task_files SET done_bytes=?, status='completed' WHERE id=?", (size, fid))

    # ---------------- 进度轮询 ----------------
    def _poll_loop(self) -> None:
        """每秒把文件进度汇总进任务行。这个线程死了，所有任务会永远停在
        「下载中 0%」而文件其实已经落盘（2026-11-12 真实发生过）——所以
        BaseException 也要接住：宿主运行时替换过的删除 API 抛的是 SystemExit，
        不属于 Exception，一旦从某个收尾路径冒上来就会无声带走整个线程。
        """
        while True:
            time.sleep(1.0)
            try:
                self._poll_once()
            except SystemExit as exc:
                print(f"[download-poller] 收到 SystemExit（多半是宿主删除守卫），忽略继续: {exc}", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"[download-poller] 轮询出错: {exc!r}", flush=True)
            except BaseException as exc:  # noqa: BLE001 - 线程绝不能静默死亡
                print(f"[download-poller] 轮询线程异常({type(exc).__name__}): {exc!r}", flush=True)

    def _poll_once(self) -> None:
        active = query("SELECT * FROM task_files WHERE status='active' AND gid IS NOT NULL")
        for row in active:
            try:
                status = self._client().tell_status(row["gid"])
            except Aria2Error:
                continue
            state = status.get("status")
            done = int(status.get("completedLength") or 0)
            total = int(status.get("totalLength") or row["size"] or 0)
            if state == "complete":
                execute("UPDATE task_files SET status='completed', done_bytes=? WHERE id=?", (max(done, total), row["id"]))
            elif state in ("error", "removed"):
                task = self._task_row(row["task_id"])
                candidates = json.loads(row.get("candidates") or "[]")
                if len([u for u in candidates if u != (row.get("url") or "")]) > 0:
                    self._fallback_or_fail(
                        row["task_id"], row, candidates, Path(task["target_dir"]), task["strategy"],
                        load_settings()["sources"].get(task["source"], {}), 0, f"aria2 error {status.get('errorCode')}",
                    )
                else:
                    execute("UPDATE task_files SET status='failed', error=? WHERE id=?", (f"aria2 error {status.get('errorCode')}", row["id"]))
            else:
                execute("UPDATE task_files SET done_bytes=?, size=CASE WHEN ? > 0 THEN ? ELSE size END WHERE id=?", (done, total, total, row["id"]))

        for task in query("SELECT * FROM tasks WHERE status NOT IN ('completed','failed','canceled')"):
            self._refresh_task(task["id"])

    def _refresh_task(self, task_id: str) -> None:
        files = query("SELECT * FROM task_files WHERE task_id=?", (task_id,))
        if not files:
            return
        total = sum(int(f["size"] or 0) for f in files)
        done = sum(int(f["done_bytes"] or 0) for f in files)
        statuses = {f["status"] for f in files}
        task = self._task_row(task_id)
        if statuses <= {"completed"}:
            execute("UPDATE tasks SET status='completed', done_bytes=?, total_bytes=?, updated_at=? WHERE id=?", (done, total, now_iso(), task_id))
            self.register_library(task_id)
            self._post_process(task)
        elif statuses <= TERMINAL:
            final = "failed" if "failed" in statuses else "canceled"
            execute("UPDATE tasks SET status=?, done_bytes=?, total_bytes=?, updated_at=? WHERE id=?", (final, done, total, now_iso(), task_id))
        else:
            execute("UPDATE tasks SET done_bytes=?, total_bytes=?, updated_at=? WHERE id=?", (done, total, now_iso(), task_id))

    # ---------------- 控制 ----------------
    def pause_task(self, task_id: str) -> dict:
        for row in query("SELECT * FROM task_files WHERE task_id=? AND status='active'", (task_id,)):
            if row["gid"]:
                try:
                    self._client().pause(row["gid"])
                except Aria2Error:
                    pass
            execute("UPDATE task_files SET status='paused' WHERE id=?", (row["id"],))
            if row["id"] in self._pause_events:
                self._pause_events[row["id"]].clear()
        execute("UPDATE tasks SET status='paused', updated_at=? WHERE id=?", (now_iso(), task_id))
        return self.get_task(task_id)

    def resume_task(self, task_id: str) -> dict:
        for row in query("SELECT * FROM task_files WHERE task_id=? AND status='paused'", (task_id,)):
            if row["gid"]:
                try:
                    self._client().unpause(row["gid"])
                    execute("UPDATE task_files SET status='active' WHERE id=?", (row["id"],))
                    continue
                except Aria2Error:
                    pass
            execute("UPDATE task_files SET status='queued' WHERE id=?", (row["id"],))
        execute("UPDATE tasks SET status='downloading', updated_at=? WHERE id=?", (now_iso(), task_id))
        rows = query("SELECT * FROM task_files WHERE task_id=? AND status='queued'", (task_id,))
        if rows:
            task = self._task_row(task_id)
            src_cfg = load_settings()["sources"].get(task["source"], {})
            for index, row in enumerate(rows):
                if task["source"] == "demo":
                    threading.Thread(
                        target=self._demo_file,
                        args=(task_id, row, self._row_dir(row, Path(task["target_dir"]))),
                        daemon=True,
                    ).start()
                else:
                    threading.Thread(
                        target=self._aria2_file,
                        args=(
                            task_id,
                            row,
                            self._row_dir(row, Path(task["target_dir"])),
                            task["strategy"],
                            src_cfg,
                            index,
                        ),
                        daemon=True,
                    ).start()
        for fid, event in self._pause_events.items():
            event.set()
        return self.get_task(task_id)

    def cancel_task(self, task_id: str) -> dict:
        self._canceled.add(task_id)
        for row in query("SELECT * FROM task_files WHERE task_id=? AND status IN ('active','paused','queued')", (task_id,)):
            if row["gid"]:
                try:
                    self._client().remove(row["gid"])
                except Aria2Error:
                    pass
            execute("UPDATE task_files SET status='canceled' WHERE id=?", (row["id"],))
        execute("UPDATE tasks SET status='canceled', updated_at=? WHERE id=?", (now_iso(), task_id))
        return self.get_task(task_id)

    def delete_task(self, task_id: str) -> dict:
        task = self._task_row(task_id)
        if not task:
            raise SourceError("任务不存在")
        if task["status"] not in TERMINAL and task["status"] != "paused":
            raise SourceError("请先取消任务再删除")
        execute("DELETE FROM task_files WHERE task_id=?", (task_id,))
        execute("DELETE FROM tasks WHERE id=?", (task_id,))
        return {"deleted": task_id}

    # ---------------- 查询 ----------------
    def _task_row(self, task_id: str) -> dict | None:
        rows = query("SELECT * FROM tasks WHERE id=?", (task_id,))
        return rows[0] if rows else None

    def get_task(self, task_id: str) -> dict:
        task = self._task_row(task_id)
        if not task:
            raise SourceError("任务不存在")
        files = query("SELECT * FROM task_files WHERE task_id=? ORDER BY path", (task_id,))
        for f in files:
            f["candidates"] = json.loads(f.get("candidates") or "[]")
        task["files"] = files
        task["kind"] = _task_kind(task.get("target_dir") or "")
        return task

    def list_tasks(self) -> list[dict]:
        result = []
        for task in query("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50"):
            files = query("SELECT * FROM task_files WHERE task_id=? ORDER BY path", (task["id"],))
            for f in files:
                f["candidates"] = json.loads(f.get("candidates") or "[]")
            task["files"] = files
            task["kind"] = _task_kind(task.get("target_dir") or "")
            result.append(task)
        return result

    # ---------------- 入库（AbyssBeacon 式本地库） ----------------
    def _post_process(self, task: dict) -> None:
        """工作流任务的收尾：把下载到的 zip 解成 json，摊进共享工作流目录。

        ComfyUI 的工作流面板只认 json，zip 摆在那里用户点不开。失败不影响
        任务本身（下载已经完成），所以只吞异常不回报错。
        """
        target = Path(task["target_dir"])
        if not _is_workflow_target(target):
            return
        try:
            from ..workflows import extract_workflow_archives

            extract_workflow_archives(target)
        except Exception:  # noqa: BLE001 - 收尾失败不该把已完成的下载标成失败
            return

    def register_library(self, task_id: str) -> None:
        task = self._task_row(task_id)
        if not task:
            return
        # 工作流不进本地模型库：模型库管的是权重文件，工作流已在共享库里
        if _is_workflow_target(task["target_dir"]):
            return
        files = query("SELECT * FROM task_files WHERE task_id=? AND status='completed'", (task_id,))
        if not files:
            return
        # 分体仓库的文件跨多个目录：没有单一 local_path，暂不自动入库，
        # 免得建出一条指向 models 根目录的错误记录（按目录分组入库在后续提交）。
        if len({f["target_dir"] or task["target_dir"] for f in files}) > 1:
            return
        existing = query("SELECT id FROM library_models WHERE local_path=?", (task["target_dir"],))
        model_id = existing[0]["id"] if existing else new_id()
        size = sum(int(f["size"] or 0) for f in files)
        name = Path(task["target_dir"]).name
        ts = now_iso()
        if existing:
            execute(
                "UPDATE library_models SET name=?, size_bytes=?, file_count=? WHERE id=?",
                (name, size, len(files), model_id),
            )
            execute("DELETE FROM library_files WHERE model_id=?", (model_id,))
        else:
            execute(
                "INSERT INTO library_models (id, name, repo_id, source, local_path, size_bytes, file_count, tags, favorite, review_state, notes, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (model_id, name, task["repo_id"], task["source"], task["target_dir"], size, len(files), "[]", 0, "untried", "", ts),
            )
        for f in files:
            execute(
                "INSERT INTO library_files (id, model_id, path, size) VALUES (?,?,?,?)",
                (new_id(), model_id, f["path"], int(f["size"] or 0)),
            )


manager = DownloadManager()
