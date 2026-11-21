"""可复现性门禁：把「报告过期 / 产物没进报告 / 拿错解释器 / research 未入库」变成机器检查。

用途
----
一次性审计 ``research/tree-resources-builder`` 这个调研目录的可复现性状态，输出 6 组检查：

1. ``artifact_freshness``  —— ``assets/validation/*.json`` 是否比 ``report.html`` 更新（报告过期）。
2. ``report_coverage``     —— 每个验证产物的 ``kind``（缺省用文件名主干）是否出现在 ``report.html`` 里。
3. ``script_interpreter``  —— 静态扫描 ``harness/*.py`` 的 import 推断所需解释器，
   与 ``plans/ENV.md`` 的对照表逐项比对。
4. ``interpreter_caps``    —— 用 ``subprocess`` 实地探测两个解释器的关键包，
   与 ``plans/ENV.md`` 的能力矩阵比对。
5. ``git_tracking``        —— ``research/`` 下未跟踪文件的数量与总字节，并给出入库/忽略建议。
6. ``plan_backfill``       —— ``plans/PLAN.md`` 的执行记录里是否提到最近的产物 kind。

用法
----
    python harness/check_repo_state.py            # 人读格式，全部检查，退出码 0
    python harness/check_repo_state.py --json     # 机器可读 JSON，退出码 0
    python harness/check_repo_state.py --strict   # 有 FAIL 时退出码 2

设计理由
--------
1. **默认退出码是 0。** 这个门禁的价值在于「持续报警」，而不是「让 CI 红」。
   当前仓库本来就有一堆待办（报告过期、research 未入库），如果默认非零退出，
   任何人跑一次门禁就会把这条检查变成噪声，久而久之没人再看它的输出。
   所以默认只打印；``--strict`` 才把 FAIL 变成退出码 2，供 CI / 收尾自检使用。

2. **只读。** 检查器绝不写任何被检查的文件：产物、报告、ENV.md、PLAN.md 一律只读。
   一个会改写被审计对象的审计工具，本身就会破坏审计结论的可信度。

3. **报告覆盖度按 ``kind`` 比对，而不是文件名。** ``kind`` 是产物自带的**语义契约标识**
   （例如 ``retarget_bvh`` / ``public_decimated``），报告正文渲染的就是它；
   文件名只是落盘路径，改名不改变语义，按文件名比对会产生「改个名就假装覆盖了」的假阴性。
   同时保留「文件名主干是否出现」作为第二信号，用来区分两种完全不同的情况：
   - ``kind`` 和文件名主干都不在报告里 -> 产物**确实**没进报告（FAIL）；
   - 文件名主干在、``kind`` 不在 -> 内容可能在报告里，但**契约标识没出现**（WARN）。

4. **解释器探测用 subprocess，不在当前进程里 import。** 同一个进程装不进两套
   numpy/torch，而且 import torch 很慢、更会污染当前解释器的模块缓存。
   每个解释器单独起一个 ``-c`` 进程探测，结果互不干扰。

5. **脚本 -> 解释器的推断走「import 闭包」。** 一个脚本真实需要的包 =
   它自己 import 的包 + 它 import 的本地模块 import 的包（本地模块 =
   ``harness/`` 下的兄弟文件）。例如 ``render_shot.py`` 自己只要 trimesh/imageio_ffmpeg，
   但它 import 的 ``pose_store`` 在运行时需要 torch+soma，于是它同时需要两个解释器，
   这就是「拆分步骤 + 文件边界」的由来。

6. **ENV.md 的两张表用 HTML 注释锚点定位**（``<!-- table:scripts -->`` /
   ``<!-- table:capabilities -->``）。文档是人写的、格式会漂，
   锚点让解析器在文档被编辑后仍能稳定找到正确的表，而不是误读相邻的表。
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field

# ------------------------------------------------------------------ 路径
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                     # research/tree-resources-builder
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))            # 仓库根
VAL_DIR = os.path.join(ROOT, "assets", "validation")
REPORT_PATH = os.path.join(ROOT, "report.html")
ENV_DOC = os.path.join(ROOT, "plans", "ENV.md")
PLAN_DOC = os.path.join(ROOT, "plans", "PLAN.md")
MAIN_PY = os.path.join(PROJ, ".venv", "Scripts", "python.exe")
SOMA_PY = os.path.join(PROJ, "var", "soma-venv", "Scripts", "python.exe")

ENV_MAIN = ".venv"
ENV_SOMA = "soma-venv"

# 同一秒内的两个时间戳没有可比性（NTFS 时间戳精度 + 报告重写顺序），
# 给 2 秒容差，避免「报告刚生成、产物同一秒落盘」被误判成过期。
FRESH_EPS = 2.0

# ------------------------------------------------------------------ 能力分组
# 「只能用 .venv」的包：soma-venv 里没有（manifold3d 负责 trimesh 布尔运算，
# fast_simplification 负责减面，imageio_ffmpeg 负责 MP4 编码）。
# 「只能用 soma-venv」的包：torch / soma / scipy，.venv 里没有。
# 其余（numpy / trimesh / pxr / PIL / networkx）两个环境都有，不构成约束。
MAIN_ONLY = {"manifold3d", "fast_simplification", "imageio_ffmpeg"}
SOMA_ONLY = {"torch", "soma", "scipy"}
CAP_PROBE_MODULES = [
    "numpy", "trimesh", "manifold3d", "pxr", "fast_simplification",
    "imageio_ffmpeg", "PIL", "scipy", "torch", "soma", "networkx",
]

# Python 3.10+ 有 sys.stdlib_module_names；3.9 没有，给一份静态兜底。
try:  # pragma: no cover - 取决于解释器版本
    _STDLIB = set(sys.stdlib_module_names)
except AttributeError:  # pragma: no cover
    _STDLIB = {
        "argparse", "ast", "base64", "collections", "contextlib", "copy", "csv",
        "dataclasses", "datetime", "functools", "glob", "hashlib", "http", "io",
        "itertools", "json", "logging", "math", "os", "pathlib", "random", "re",
        "shutil", "stat", "statistics", "struct", "subprocess", "sys", "tempfile",
        "textwrap", "time", "traceback", "typing", "urllib", "zipfile",
    }

PROBE_CODE = r"""
import json, sys
mods = json.loads(sys.argv[1])
out = {}
for m in mods:
    try:
        __import__(m)
        out[m] = True
    except Exception:
        out[m] = False
print(json.dumps(out))
"""

# ------------------------------------------------------------------ 结果模型
PASS, WARN, FAIL = "PASS", "WARN", "FAIL"


@dataclass
class Finding:
    """一条检查结论。

    evidence 里必须放**可定位的证据**（文件名 / 相对路径 / mtime / 数量），
    只有布尔值的话，报警出来也没人知道该去看哪个文件。
    """

    id: str
    title: str
    status: str
    summary: str
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "summary": self.summary,
            "evidence": list(self.evidence),
        }


# ------------------------------------------------------------------ 工具函数
def _ts(mtime: float) -> str:
    from datetime import datetime

    return datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")


def _rel(path: str, base: str = ROOT) -> str:
    try:
        return os.path.relpath(path, base).replace(os.sep, "/")
    except ValueError:  # pragma: no cover - 跨盘符
        return path


def _read_text(path: str) -> str:
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def _read_json(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def artifact_identifier(path: str, payload=None) -> str:
    """取产物的语义标识：优先 ``kind``，缺省用文件名主干。

    为什么要 ``kind`` 优先：它是产物自带的契约字段，改文件名不影响语义。
    为什么要有文件名兜底：早期产物（``exports.json`` / ``public_assets.json`` 等）
    还没写 ``kind``，不能因为缺字段就当它们「一定没进报告」——那会让告警失去区分度。
    """
    if payload is None:
        try:
            payload = _read_json(path)
        except Exception:
            payload = None
    if isinstance(payload, dict):
        kind = payload.get("kind")
        if isinstance(kind, str) and kind.strip():
            return kind.strip()
    return os.path.splitext(os.path.basename(path))[0]


# ------------------------------------------------------------------ import 扫描
def _local_module_names(harness_dir: str) -> set:
    names = set()
    for fn in os.listdir(harness_dir):
        if fn.endswith(".py") and not fn.startswith("__"):
            names.add(fn[:-3])
    return names


def _module_imports(path: str) -> set:
    """收集一个文件 import 的所有顶层模块名（含函数体内的延迟 import）。

    延迟 import 也要算：``pose_store`` 里的 ``import torch`` 在函数体内，
    但它决定了「这个脚本到底需要哪个解释器」，漏掉它会把跨环境脚本误判成单环境。
    """
    try:
        tree = ast.parse(_read_text(path))
    except Exception:
        return set()
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mods.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                continue  # 相对 import：本地模块，不算第三方
            if node.module:
                mods.add(node.module.split(".")[0])
    return mods


def script_requirements(harness_dir: str) -> dict:
    """推断每个 harness 脚本需要的解释器。

    返回 {脚本名: {"envs": [...], "modules": {...}, "reason": "..."}}。
    """
    local = _local_module_names(harness_dir)
    cache = {}

    def resolve(name, seen):
        if name in cache:
            return cache[name]
        if name in seen:  # 循环 import，剪枝
            return set(), {}
        seen = seen | {name}
        path = os.path.join(harness_dir, name + ".py")
        if not os.path.isfile(path):
            return set(), {}
        third = set()
        for m in _module_imports(path):
            if m in local:
                sub, _ = resolve(m, seen)
                third |= sub
            elif m not in _STDLIB and m != "__future__":
                third.add(m)
        cache[name] = (third, {})
        return third, {}

    out = {}
    for fn in sorted(os.listdir(harness_dir)):
        if not fn.endswith(".py") or fn.startswith("__"):
            continue
        name = fn[:-3]
        third, _ = resolve(name, frozenset())
        forced_main = sorted(m for m in third if m in MAIN_ONLY)
        forced_soma = sorted(m for m in third if m in SOMA_ONLY)
        envs = []
        if forced_soma:
            envs.append(ENV_SOMA)
        if forced_main or not forced_soma:
            envs.append(ENV_MAIN)
        reason = []
        if forced_soma:
            reason.append("需要 soma-venv 的包: " + ", ".join(forced_soma))
        if forced_main:
            reason.append("需要 .venv 独有的包: " + ", ".join(forced_main))
        if not reason:
            reason.append("只依赖 numpy/trimesh/PIL 等两环境共有包，约定用 .venv")
        out[fn] = {"envs": envs, "third_party": sorted(third),
                   "reason": "；".join(reason)}
    return out


def env_class(envs) -> str:
    """把解释器集合归成三类：单 .venv / 单 soma-venv / 拆分。"""
    s = set(envs)
    if s == {ENV_MAIN}:
        return "main"
    if s == {ENV_SOMA}:
        return "soma"
    return "split"


# ------------------------------------------------------------------ ENV.md 解析
def _section_tables(text: str):
    """按 HTML 注释锚点切出 ENV.md 里的表格区块。"""
    out = {}
    for anchor in ("scripts", "capabilities"):
        marker = f"<!-- table:{anchor} -->"
        idx = text.find(marker)
        if idx < 0:
            out[anchor] = []
            continue
        chunk = text[idx + len(marker):]
        end = chunk.find("<!-- /table:")
        if end >= 0:
            chunk = chunk[:end]
        rows = []
        for line in chunk.splitlines():
            line = line.strip()
            if not line.startswith("|"):
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) < 2:
                continue
            if cells[0].startswith("---") or set(cells[0]) <= {"-", ":"}:
                continue
            rows.append(cells)
        # 去掉表头行
        if rows and ("脚本" in rows[0][0] or "能力" in rows[0][0] or "模块" in rows[0][0]):
            rows = rows[1:]
        out[anchor] = rows
    return out


def parse_env_doc(path: str):
    """解析 ENV.md 的两张表。

    scripts 表：``| `foo.py` | `.venv` | 依据 |``
    capabilities 表：``| `numpy` | ✅ 2.5.4 | ✅ 2.4.6 |``
    """
    if not os.path.isfile(path):
        return {"scripts": {}, "caps": {}, "present": False}
    text = _read_text(path)
    tables = _section_tables(text)
    scripts = {}
    for cells in tables["scripts"]:
        name = cells[0].strip("`").strip()
        if not name.endswith(".py"):
            continue
        token = cells[1]
        scripts[name] = token
    caps = {}
    for cells in tables["capabilities"]:
        mod = cells[0].strip("`").strip()
        if not mod or not _is_ident(mod):
            continue
        row = {}
        for env, cell in ((ENV_MAIN, cells[1] if len(cells) > 1 else ""),
                          (ENV_SOMA, cells[2] if len(cells) > 2 else "")):
            row[env] = ("✅" in cell)
        caps[mod] = row
    return {"scripts": scripts, "caps": caps, "present": True}


def _is_ident(s: str) -> bool:
    """是否像一个 Python 模块名（用来过滤掉表头/说明行）。"""
    return bool(s) and all(c.isalnum() or c == "_" for c in s)


def _token_class(token: str) -> str:
    t = (token or "").lower()
    has_main = ".venv" in t or "主环境" in t
    has_soma = "soma-venv" in t or "soma 虚拟环境" in t
    if has_main and has_soma:
        return "split"
    if has_soma:
        return "soma"
    if has_main:
        return "main"
    return "unknown"


# ------------------------------------------------------------------ 检查 1：新鲜度
def check_freshness(val_dir: str = VAL_DIR, report_path: str = REPORT_PATH) -> Finding:
    """比较每个验证产物的 mtime 与报告 mtime。"""
    ev = []
    if not os.path.isfile(report_path):
        return Finding("artifact_freshness", "产物新鲜度", FAIL,
                       f"找不到报告 {report_path}", [f"报告路径: {report_path}"])
    rmt = os.path.getmtime(report_path)
    ev.append(f"报告 {_rel(report_path)} mtime={_ts(rmt)}")
    if not os.path.isdir(val_dir):
        return Finding("artifact_freshness", "产物新鲜度", WARN,
                       f"找不到验证目录 {val_dir}", [f"目录: {val_dir}"])
    newer = []
    for fn in sorted(os.listdir(val_dir)):
        if not fn.endswith(".json"):
            continue
        p = os.path.join(val_dir, fn)
        mt = os.path.getmtime(p)
        if mt - rmt > FRESH_EPS:
            newer.append((fn, mt, mt - rmt))
    for fn, mt, dt in newer:
        ev.append(f"产物更新于报告之后: assets/validation/{fn} mtime={_ts(mt)} "
                  f"(比报告晚 {dt:.0f}s / {dt/60:.1f} 分钟)")
    if newer:
        names = ", ".join(f for f, _, _ in newer)
        return Finding("artifact_freshness", "产物新鲜度", FAIL,
                       f"报告比 {len(newer)} 个产物旧，报告内容已过期：{names}",
                       ev)
    return Finding("artifact_freshness", "产物新鲜度", PASS,
                   "所有验证产物都不比报告新", ev)


# ------------------------------------------------------------------ 检查 2：报告覆盖度
def check_report_coverage(val_dir: str = VAL_DIR, report_path: str = REPORT_PATH) -> Finding:
    """检查每个验证产物的标识是否出现在报告正文里。"""
    ev = []
    if not os.path.isfile(report_path):
        return Finding("report_coverage", "报告覆盖度", FAIL,
                       f"找不到报告 {report_path}", [f"报告路径: {report_path}"])
    html = _read_text(report_path)
    ev.append(f"报告 {_rel(report_path)} 大小={len(html)} 字符")
    if not os.path.isdir(val_dir):
        return Finding("report_coverage", "报告覆盖度", WARN,
                       f"找不到验证目录 {val_dir}", [f"目录: {val_dir}"])
    missing_hard, missing_soft, covered = [], [], []
    for fn in sorted(os.listdir(val_dir)):
        if not fn.endswith(".json"):
            continue
        p = os.path.join(val_dir, fn)
        ident = artifact_identifier(p)
        stem = os.path.splitext(fn)[0]
        if ident in html:
            covered.append(ident)
            continue
        if stem in html:
            missing_soft.append((fn, ident))
        else:
            missing_hard.append((fn, ident))
    for fn, ident in missing_hard:
        ev.append(f"未进入报告: assets/validation/{fn} (kind/stem={ident})")
    for fn, ident in missing_soft:
        ev.append(f"契约标识缺失: assets/validation/{fn} 的 kind={ident} 不在报告里，"
                  f"但文件名主干 {os.path.splitext(fn)[0]} 出现过（内容可能已进报告）")
    ev.append(f"已覆盖 {len(covered)} 个: " + (", ".join(covered) if covered else "无"))
    if missing_hard:
        return Finding("report_coverage", "报告覆盖度", FAIL,
                       f"{len(missing_hard)} 个验证产物既没有 kind 也没有文件名出现在 report.html 里",
                       ev)
    if missing_soft:
        return Finding("report_coverage", "报告覆盖度", WARN,
                       f"{len(missing_soft)} 个产物的 kind 标识没出现在 report.html 里",
                       ev)
    return Finding("report_coverage", "报告覆盖度", PASS,
                   f"{len(covered)} 个验证产物的标识都能在 report.html 里找到", ev)


# ------------------------------------------------------------------ 检查 3：脚本 -> 解释器
def check_script_interpreter(harness_dir: str = HERE, env_doc: str = ENV_DOC) -> Finding:
    """静态推断所需解释器，与 ENV.md 对照表逐项比对。"""
    ev = []
    req = script_requirements(harness_dir)
    doc = parse_env_doc(env_doc)
    if not doc["present"]:
        return Finding("script_interpreter", "脚本->解释器一致性", FAIL,
                       f"找不到环境说明 {env_doc}", [f"路径: {env_doc}"])
    table = doc["scripts"]
    ev.append(f"ENV.md 对照表收录 {len(table)} 个脚本；磁盘上 harness/*.py 有 {len(req)} 个")

    missing_rows, stale_rows, mismatch = [], [], []
    for fn, info in sorted(req.items()):
        want = env_class(info["envs"])
        if fn not in table:
            missing_rows.append((fn, want, info["reason"]))
            continue
        got = _token_class(table[fn])
        if got != want:
            mismatch.append((fn, want, got, info["reason"]))
    for fn in sorted(table):
        if fn not in req:
            stale_rows.append(fn)

    for fn, want, reason in missing_rows:
        ev.append(f"ENV.md 缺少条目: {fn}（推断应为 {_label(want)}；{reason}）")
    for fn, want, got, reason in mismatch:
        ev.append(f"解释器不一致: {fn} 推断={_label(want)}（{reason}） vs "
                  f"ENV.md 声明={table[fn]!r}（归类 {got}）")
    for fn in stale_rows:
        ev.append(f"ENV.md 里有 {fn}，但磁盘上不存在（文档过期）")

    if len(table) < 20:
        ev.append(f"ENV.md 对照表只覆盖 {len(table)} 个脚本，少于要求的 20 个")

    if mismatch or missing_rows or stale_rows or len(table) < 20:
        status = FAIL
        parts = []
        if missing_rows:
            parts.append(f"{len(missing_rows)} 个脚本没有对照条目")
        if mismatch:
            parts.append(f"{len(mismatch)} 个脚本解释器不一致")
        if stale_rows:
            parts.append(f"{len(stale_rows)} 个条目指向不存在的脚本")
        if len(table) < 20:
            parts.append(f"对照表仅 {len(table)} 条 (< 20)")
        return Finding("script_interpreter", "脚本->解释器一致性", FAIL,
                       "ENV.md 与实际 import 扫描对不上：" + "；".join(parts), ev)
    return Finding("script_interpreter", "脚本->解释器一致性", PASS,
                   f"{len(req)} 个脚本的解释器与 ENV.md 对照表逐项一致", ev)


def _label(cls: str) -> str:
    return {ENV_MAIN: ENV_MAIN, ENV_SOMA: ENV_SOMA, "split": f"拆分({ENV_SOMA} + {ENV_MAIN})"}.get(cls, cls)


# ------------------------------------------------------------------ 检查 4：解释器能力
def probe_interpreter(python_exe: str, modules=None) -> dict:
    """用子进程探测一个解释器里各模块是否可 import。"""
    modules = modules or CAP_PROBE_MODULES
    if not python_exe or not os.path.isfile(python_exe):
        return {"exists": False, "python": python_exe, "modules": {}}
    try:
        proc = subprocess.run([python_exe, "-c", PROBE_CODE, json.dumps(modules)],
                              capture_output=True, text=True, timeout=180)
    except Exception as exc:  # noqa: BLE001
        return {"exists": True, "python": python_exe, "modules": {}, "error": str(exc)}
    if proc.returncode != 0:
        return {"exists": True, "python": python_exe, "modules": {},
                "error": (proc.stderr or "").strip()[:500]}
    try:
        got = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception as exc:  # noqa: BLE001
        return {"exists": True, "python": python_exe, "modules": {}, "error": f"解析失败: {exc}"}
    return {"exists": True, "python": python_exe, "modules": got}


def check_interpreter_caps(env_doc: str = ENV_DOC) -> Finding:
    """实测两个解释器的能力，与 ENV.md 声明的能力矩阵比对。"""
    ev = []
    doc = parse_env_doc(env_doc)
    if not doc["present"]:
        return Finding("interpreter_caps", "解释器能力核对", FAIL,
                       f"找不到环境说明 {env_doc}", [f"路径: {env_doc}"])
    caps = doc["caps"]
    if not caps:
        return Finding("interpreter_caps", "解释器能力核对", FAIL,
                       "ENV.md 里没有找到能力矩阵表（缺少 <!-- table:capabilities --> 锚点）", ev)

    probes = {
        ENV_MAIN: probe_interpreter(MAIN_PY),
        ENV_SOMA: probe_interpreter(SOMA_PY),
    }
    for env, pr in probes.items():
        if not pr.get("exists"):
            ev.append(f"{env} 解释器不可用: {pr.get('python')}")
            continue
        have = [m for m in CAP_PROBE_MODULES if pr["modules"].get(m)]
        miss = [m for m in CAP_PROBE_MODULES if not pr["modules"].get(m)]
        ev.append(f"{env} ({pr['python']}) 实测有: {', '.join(have) or '无'}")
        ev.append(f"{env} 实测缺: {', '.join(miss) or '无'}")

    hard, soft = [], []
    for mod, row in sorted(caps.items()):
        for env in (ENV_MAIN, ENV_SOMA):
            pr = probes[env]
            if not pr.get("exists") or not pr.get("modules"):
                continue
            actual = bool(pr["modules"].get(mod))
            declared = bool(row.get(env))
            if declared and not actual:
                hard.append(f"{env} 缺 {mod}（ENV.md 声明有，实测 import 失败 -> 会 ImportError）")
            elif actual and not declared:
                soft.append(f"{env} 实际有 {mod}（ENV.md 声明无，文档偏保守）")
    ev.extend(hard)
    ev.extend(soft)
    if hard:
        return Finding("interpreter_caps", "解释器能力核对", FAIL,
                       f"{len(hard)} 项声明与实测不符（会直接 ImportError）", ev)
    if soft:
        return Finding("interpreter_caps", "解释器能力核对", WARN,
                       f"{len(soft)} 项 ENV.md 声明偏保守（实测多出可用包）", ev)
    return Finding("interpreter_caps", "解释器能力核对", PASS,
                   "ENV.md 能力矩阵与两个解释器的实测结果一致", ev)


# ------------------------------------------------------------------ 检查 5：git 跟踪
def _git(repo_root: str, *args) -> tuple:
    try:
        proc = subprocess.run(["git", "-C", repo_root, *args],
                              capture_output=True, text=True, timeout=180)
    except Exception as exc:  # noqa: BLE001
        return 1, "", str(exc)
    return proc.returncode, proc.stdout, proc.stderr


def check_git_tracking(repo_root: str = PROJ, rel_subdir: str = "research/") -> Finding:
    """统计 research/ 下未跟踪文件的数量与字节，并给入库/忽略建议。"""
    ev = []
    code, out, err = _git(repo_root, "ls-files", "--others", "--exclude-standard", "--", rel_subdir)
    if code != 0:
        return Finding("git_tracking", "git 跟踪状态", WARN,
                       f"git ls-files 失败：{err.strip()[:200]}", ev)
    untracked = [ln for ln in out.splitlines() if ln.strip()]
    code, out2, _ = _git(repo_root, "ls-files", "--", rel_subdir)
    tracked = [ln for ln in out2.splitlines() if ln.strip()] if code == 0 else []

    total = 0
    missing = 0
    for rel in untracked:
        p = os.path.join(repo_root, rel.replace("/", os.sep))
        try:
            total += os.path.getsize(p)
        except OSError:
            missing += 1
    ev.append(f"未跟踪文件 {len(untracked)} 个，合计 {total} 字节 "
              f"({total/1024/1024:.1f} MB)")
    ev.append(f"已跟踪文件 {len(tracked)} 个")
    if missing:
        ev.append(f"有 {missing} 个未跟踪文件读不到大小（可能已被删除）")

    buckets = {"source": [], "doc": [], "validation_json": [],
               "frames": [], "report_html": [], "raw": [], "other": []}
    for rel in untracked:
        low = rel.lower()
        if rel.endswith(".py"):
            buckets["source"].append(rel)
        elif rel.endswith(".md"):
            buckets["doc"].append(rel)
        elif rel.endswith(".json") and "/validation/" in low:
            buckets["validation_json"].append(rel)
        elif "/frames/" in low or low.startswith("research/tree-resources-builder/shots/"):
            buckets["frames"].append(rel)
        elif low.endswith("report.html"):
            buckets["report_html"].append(rel)
        elif "/var/" in low or low.startswith("var/"):
            buckets["raw"].append(rel)
        else:
            buckets["other"].append(rel)

    ev.append("建议入库（源码/文档/验证 JSON，体积小且是复现依据）: "
              f"源码 {len(buckets['source'])} 个 / 文档 {len(buckets['doc'])} 个 / "
              f"验证 JSON {len(buckets['validation_json'])} 个")
    ev.append("建议忽略（帧序列 / 报告 HTML / 原始下载包，体积大且可重建）: "
              f"帧序列 {len(buckets['frames'])} 个 / 报告 HTML {len(buckets['report_html'])} 个 / "
              f"原始下载包 {len(buckets['raw'])} 个")
    ev.append("建议追加到 .gitignore: research/tree-resources-builder/shots/*/frames/、"
              "research/tree-resources-builder/report.html、"
              "research/tree-resources-builder/harness/_tmp_cam/、"
              "research/tree-resources-builder/harness/__pycache__/")

    if not untracked:
        return Finding("git_tracking", "git 跟踪状态", PASS,
                       f"{rel_subdir} 没有任何未跟踪文件", ev)
    if not tracked:
        return Finding("git_tracking", "git 跟踪状态", WARN,
                       f"{rel_subdir} 下 {len(untracked)} 个文件全部未跟踪，"
                       f"{total/1024/1024:.1f} MB 成果只存在于本地工作区，没有版本历史", ev)
    return Finding("git_tracking", "git 跟踪状态", WARN,
                   f"{rel_subdir} 下 {len(untracked)} 个未跟踪文件 / {total/1024/1024:.1f} MB 未入库"
                   f"（已跟踪 {len(tracked)} 个）", ev)


# ------------------------------------------------------------------ 检查 6：PLAN 回填
def check_plan_backfill(val_dir: str = VAL_DIR, plan_doc: str = PLAN_DOC) -> Finding:
    """检查 PLAN.md 的执行记录有没有提到最近的产物 kind。"""
    ev = []
    if not os.path.isfile(plan_doc):
        return Finding("plan_backfill", "PLAN 回填", WARN,
                       f"找不到计划文档 {plan_doc}", [f"路径: {plan_doc}"])
    text = _read_text(plan_doc)
    ev.append(f"计划文档 {_rel(plan_doc)} 大小={len(text)} 字符")
    if not os.path.isdir(val_dir):
        return Finding("plan_backfill", "PLAN 回填", WARN,
                       f"找不到验证目录 {val_dir}", [f"目录: {val_dir}"])
    missing, present = [], []
    for fn in sorted(os.listdir(val_dir)):
        if not fn.endswith(".json"):
            continue
        p = os.path.join(val_dir, fn)
        ident = artifact_identifier(p)
        stem = os.path.splitext(fn)[0]
        if ident in text or stem in text:
            present.append(ident)
        else:
            missing.append((fn, ident))
    for fn, ident in missing:
        ev.append(f"PLAN.md 未提到产物: assets/validation/{fn} (kind={ident})")
    ev.append(f"PLAN.md 已提到 {len(present)} 个: " + (", ".join(present) if present else "无"))
    if missing:
        return Finding("plan_backfill", "PLAN 回填", WARN,
                       f"{len(missing)} 个产物没在 PLAN.md 执行记录里回填："
                       + ", ".join(f"{fn}({ident})" for fn, ident in missing), ev)
    return Finding("plan_backfill", "PLAN 回填", PASS,
                   f"{len(present)} 个产物标识都能在 PLAN.md 里找到", ev)


# ------------------------------------------------------------------ 汇总
def run_all(project_root: str = ROOT, repo_root: str = PROJ) -> list:
    """跑全部检查。任何单条检查内部异常都被收敛成一条 FAIL，不让门禁自己崩掉。"""
    val_dir = os.path.join(project_root, "assets", "validation")
    report_path = os.path.join(project_root, "report.html")
    harness_dir = os.path.join(project_root, "harness")
    env_doc = os.path.join(project_root, "plans", "ENV.md")
    plan_doc = os.path.join(project_root, "plans", "PLAN.md")
    checks = [
        ("artifact_freshness", lambda: check_freshness(val_dir, report_path)),
        ("report_coverage", lambda: check_report_coverage(val_dir, report_path)),
        ("script_interpreter", lambda: check_script_interpreter(harness_dir, env_doc)),
        ("interpreter_caps", lambda: check_interpreter_caps(env_doc)),
        ("git_tracking", lambda: check_git_tracking(repo_root)),
        ("plan_backfill", lambda: check_plan_backfill(val_dir, plan_doc)),
    ]
    findings = []
    for cid, fn in checks:
        try:
            findings.append(fn())
        except Exception as exc:  # noqa: BLE001
            import traceback
            findings.append(Finding(cid, cid, FAIL, f"检查器内部异常: {type(exc).__name__}: {exc}",
                                    [traceback.format_exc()[-800:]]))
    return findings


def _print_text(findings: list) -> None:
    icon = {PASS: "[PASS]", WARN: "[WARN]", FAIL: "[FAIL]"}
    print("=" * 78)
    print("可复现性门禁 · research/tree-resources-builder")
    print("=" * 78)
    for f in findings:
        print(f"{icon.get(f.status, f.status)} {f.id} — {f.title}")
        print(f"       {f.summary}")
        for line in f.evidence:
            print(f"       · {line}")
        print("-" * 78)
    n_fail = sum(1 for f in findings if f.status == FAIL)
    n_warn = sum(1 for f in findings if f.status == WARN)
    n_pass = sum(1 for f in findings if f.status == PASS)
    print(f"合计: PASS {n_pass} / WARN {n_warn} / FAIL {n_fail}")
    if n_fail:
        print("提示: 加 --strict 会在有 FAIL 时以退出码 2 结束（供 CI / 收尾自检用）")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="可复现性门禁：检查报告新鲜度、报告覆盖度、解释器一致性与 git 跟踪状态")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    ap.add_argument("--strict", action="store_true",
                    help="有 FAIL 项时退出码 2（默认恒为 0，因为报警是常态而非失败）")
    ap.add_argument("--project-root", default=ROOT, help="调研目录根（默认脚本所在项目）")
    ap.add_argument("--repo-root", default=PROJ, help="git 仓库根（默认向上两级）")
    args = ap.parse_args(argv)

    findings = run_all(args.project_root, args.repo_root)

    if args.json:
        payload = {
            "project_root": args.project_root,
            "repo_root": args.repo_root,
            "summary": {
                "pass": sum(1 for f in findings if f.status == PASS),
                "warn": sum(1 for f in findings if f.status == WARN),
                "fail": sum(1 for f in findings if f.status == FAIL),
            },
            "findings": [f.to_dict() for f in findings],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        _print_text(findings)

    if args.strict and any(f.status == FAIL for f in findings):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
