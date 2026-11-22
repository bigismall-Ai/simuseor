# R7 配方契约：schema、字段声明、提示词构造、hint 构造、JSON 抽取。
#
# 契约是什么
# ----------
# 云端 LLM 在闭环里**只做一件事**：把一份「任务规格」翻译成一份 JSON 配方。
# 配方字段、类型、区间、命名规则全部在这里声明清楚——新增字段必须同时在
# CATEGORY_PARAMS 里声明，否则形状校验（RECIPE_FIELDS）直接判红。
#
# 谁判对错
# --------
# 不是模型自评：形状/类型/区间由 r7_contract.check_shape 机器判，
# 几何与结构由 r7_judge 机器判。模型只负责产出 JSON，判定权在校验器手里
# （ROADMAP R7「明确不做」：不把「模型认为对了」当作通过）。
from __future__ import annotations

import json
import re
from typing import Any

RECIPE_SCHEMA = "r7-recipe/1"
RECIPE_KIND = "r7_recipe"

#: 顶层必填字段（顺序即提示词里的展示顺序）
TOP_FIELDS = ("kind", "schema", "task_id", "asset_name", "usage_level",
              "category", "params", "license", "notes")

#: 分类别参数字段声明：name -> (类型, 说明)
#: 类型取值：number / integer / string / enum / number[] / integer[] / object
CATEGORY_PARAMS: dict[str, list[dict[str, Any]]] = {
    "prop": [
        {"name": "scale_factor", "type": "number",
         "desc": "源件等比缩放系数（= 目标最大边长 / 源件当前最大边长）"},
        {"name": "target_max_dim_m", "type": "number",
         "desc": "缩放后资产的最大边长（米）"},
    ],
    "tree": [
        {"name": "height", "type": "number", "desc": "整树高度（米）"},
        {"name": "trunk_r", "type": "number", "desc": "主干半径（米）"},
        {"name": "canopy_r", "type": "number", "desc": "冠层半径（米）"},
        {"name": "canopy_h", "type": "number", "desc": "冠层厚度（米）"},
        {"name": "shape", "type": "enum", "desc": "冠形：round / conical / column / wide / palm / bare"},
        {"name": "branches", "type": "integer", "desc": "每级分枝数"},
        {"name": "levels", "type": "integer", "desc": "递归分枝层数"},
        {"name": "seed", "type": "integer", "desc": "随机种子（决定分枝形态）"},
        {"name": "lod", "type": "object",
         "desc": "LOD 参数：segments / levels / canopy_blobs / canopy_subdiv / branch_ratio"},
    ],
    "vehicle": [
        {"name": "length", "type": "number", "desc": "车长（米）"},
        {"name": "width", "type": "number", "desc": "车宽（米）"},
        {"name": "clearance", "type": "number", "desc": "离地间隙（米）"},
        {"name": "roof", "type": "number[]", "desc": "12 个站位的车顶高度（米），顺序为车头→车尾"},
        {"name": "cabin", "type": "number[]", "desc": "座舱跨度的两个站位号（0–11 的整数）"},
        {"name": "cabin_h", "type": "number", "desc": "座舱高度（米）"},
        {"name": "wheel_r", "type": "number", "desc": "车轮半径（米）"},
        {"name": "wheelbase", "type": "number[]", "desc": "前后轴位置（米，形如 [1.36, -1.36]）"},
        {"name": "track", "type": "number", "desc": "轮距的一半（米）"},
    ],
    "scene": [
        {"name": "floors", "type": "integer", "desc": "楼体层数"},
        {"name": "width", "type": "number", "desc": "楼体面宽（米）"},
        {"name": "depth", "type": "number", "desc": "楼体进深（米）"},
        {"name": "building_count", "type": "integer", "desc": "楼体数量"},
        {"name": "tree_count", "type": "integer", "desc": "行道树数量"},
        {"name": "prop_count", "type": "integer", "desc": "公共件数量"},
        {"name": "vehicle_count", "type": "integer", "desc": "车辆数量"},
        {"name": "char_count", "type": "integer", "desc": "人物数量"},
        {"name": "seed", "type": "integer", "desc": "摆位随机种子"},
    ],
    "character": [
        {"name": "height", "type": "number", "desc": "身高（米）"},
        {"name": "torso", "type": "number", "desc": "躯干围度系数（1.0 为基准）"},
        {"name": "shoulder", "type": "number", "desc": "肩宽系数"},
        {"name": "hip", "type": "number", "desc": "胯宽系数"},
        {"name": "limb", "type": "number", "desc": "肢体粗细系数"},
        {"name": "head", "type": "number", "desc": "头部尺寸系数"},
        {"name": "variant", "type": "string", "desc": "变体名（小写字母与下划线）"},
    ],
}

LOD_FIELDS = {
    "segments": "圆柱截面段数",
    "levels": "分枝层数上限",
    "canopy_blobs": "冠层球数",
    "canopy_subdiv": "球体细分级数",
    "branch_ratio": "子枝长度比",
}

LICENSE_FIELDS = ("spdx", "credit", "source_url", "attribution_required")


def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


def _int(v) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return int(v)
    if isinstance(v, float) and abs(v - round(v)) < 1e-9:
        return int(round(v))
    return None


def check_shape(recipe: Any, task: dict[str, Any]) -> list[dict[str, Any]]:
    """配方形状/类型/区间/许可 的机器判定（不涉及几何）。"""
    checks: list[dict[str, Any]] = []

    def add(code, ok, message, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": message, "hint": hint})

    if not isinstance(recipe, dict):
        add("RECIPE_JSON", False, "配方不是 JSON 对象", "必须输出一个 JSON 对象")
        return checks
    add("RECIPE_JSON", True, "配方是合法 JSON 对象")

    add("RECIPE_SCHEMA",
        recipe.get("schema") == RECIPE_SCHEMA and recipe.get("kind") == RECIPE_KIND,
        "schema=%r kind=%r（期望 %r / %r）"
        % (recipe.get("schema"), recipe.get("kind"), RECIPE_SCHEMA, RECIPE_KIND),
        "配方头部固定：kind=%s, schema=%s" % (RECIPE_KIND, RECIPE_SCHEMA))

    missing = [f for f in TOP_FIELDS if f not in recipe]
    extra = [f for f in recipe if f not in TOP_FIELDS]
    add("RECIPE_FIELDS", not missing and not extra,
        "缺字段 %s；多余字段 %s" % (missing or "无", extra or "无"),
        "顶层字段固定为：%s" % ", ".join(TOP_FIELDS))

    if missing:
        return checks

    add("RECIPE_TASK", recipe.get("task_id") == task["task_id"],
        "task_id=%r（期望 %r）" % (recipe.get("task_id"), task["task_id"]),
        "task_id 必须原样回写任务里给的值")

    add("RECIPE_CATEGORY", recipe.get("category") == task["category"],
        "category=%r（期望 %r）" % (recipe.get("category"), task["category"]),
        "category 必须与任务一致")
    add("RECIPE_TIER", recipe.get("usage_level") == task["usage_level"],
        "usage_level=%r（期望 %r）" % (recipe.get("usage_level"), task["usage_level"]),
        "用途分级按任务给的档位写，不要自选")

    name = str(recipe.get("asset_name") or "")
    pattern = task.get("naming", {}).get("pattern")
    if pattern:
        ok = bool(re.match(pattern, name))
        add("NAME_CONVENTION", ok, "资产名 %r（要求匹配 %s）" % (name, pattern),
            "命名规则：<类别词>_<名字>_<变体>，类别词取自语义表")
    else:
        add("NAME_CONVENTION", bool(name), "资产名 %r" % name, "资产名不能为空")

    lic = recipe.get("license")
    if not isinstance(lic, dict):
        add("LICENSE_PRESENT", False, "license 段缺失或不是对象",
            "license 需要 spdx 与 credit")
    else:
        missing_lic = [f for f in ("spdx", "credit") if not str(lic.get(f) or "").strip()]
        extra_lic = [f for f in lic if f not in LICENSE_FIELDS]
        add("LICENSE_PRESENT", not missing_lic and not extra_lic,
            "缺 %s；多余 %s" % (missing_lic or "无", extra_lic or "无"),
            "license 字段固定为：%s" % ", ".join(LICENSE_FIELDS))

    params = recipe.get("params")
    declared = CATEGORY_PARAMS.get(task["category"], [])
    declared_names = [d["name"] for d in declared]
    if not isinstance(params, dict):
        add("RECIPE_TYPES", False, "params 段缺失或不是对象", "params 必须是对象")
        return checks
    p_missing = [f for f in declared_names if f not in params]
    p_extra = [f for f in params if f not in declared_names]
    add("RECIPE_FIELDS", not p_missing and not p_extra,
        "params 缺 %s；多余 %s" % (p_missing or "无", p_extra or "无"),
        "params 字段固定为：%s" % ", ".join(declared_names))
    if p_missing:
        return checks

    spec = task.get("fields", {})
    type_bad: list[str] = []
    range_bad: list[str] = []
    for d in declared:
        name_ = d["name"]
        val = params.get(name_)
        t = d["type"]
        if t == "number":
            if _num(val) is None:
                type_bad.append("%s(需数字)" % name_)
        elif t == "integer":
            if _int(val) is None:
                type_bad.append("%s(需整数)" % name_)
        elif t == "string":
            if not isinstance(val, str):
                type_bad.append("%s(需字符串)" % name_)
        elif t == "enum":
            allowed = spec.get(name_, {}).get("enum") or []
            if val not in allowed:
                type_bad.append("%s(取值须在 %s)" % (name_, allowed))
        elif t == "number[]":
            if not isinstance(val, list) or not val or any(_num(x) is None for x in val):
                type_bad.append("%s(需非空数字数组)" % name_)
        elif t == "integer[]":
            if not isinstance(val, list) or not val or any(_int(x) is None for x in val):
                type_bad.append("%s(需非空整数数组)" % name_)
        elif t == "object":
            if not isinstance(val, dict):
                type_bad.append("%s(需对象)" % name_)
            else:
                lod_missing = [k for k in LOD_FIELDS if k not in val]
                lod_extra = [k for k in val if k not in LOD_FIELDS]
                if lod_missing or lod_extra:
                    type_bad.append("%s.lod(缺 %s 多 %s)"
                                   % (name_, lod_missing or "无", lod_extra or "无"))

    add("RECIPE_TYPES", not type_bad, "类型不符：%s" % ("；".join(type_bad) or "无"),
        "按声明的类型写：number/integer/string/enum/number[]/object")

    for d in declared:
        name_ = d["name"]
        rule = spec.get(name_)
        if not rule:
            continue
        val = params.get(name_)
        subs = rule.get("subfields")
        if subs and isinstance(val, dict):
            for sub, srule in subs.items():
                if "range" not in srule:
                    continue
                lo, hi = srule["range"]
                sv = val.get(sub)
                fv = _num(sv)
                if fv is None or not (lo - 1e-9 <= fv <= hi + 1e-9):
                    range_bad.append("%s.%s=%s 越界 [%g, %g]"
                                     % (name_, sub, sv, lo, hi))
        if "range" in rule:
            lo, hi = rule["range"]
            nums = val if isinstance(val, list) else [val]
            bad = []
            for x in nums:
                fx = _num(x)
                if fx is None:
                    bad.append(str(x))
                elif not (lo - 1e-9 <= fx <= hi + 1e-9):
                    bad.append("%g" % fx)
            if bad:
                range_bad.append("%s=%s 越界 [%g, %g]" % (name_, "/".join(bad), lo, hi))
        if "ranges" in rule and isinstance(val, list):
            # 逐元素区间（例如 cabin 两个站位各有各的范围）
            for idx, rng in enumerate(rule["ranges"]):
                if idx >= len(val):
                    break
                fx = _num(val[idx])
                lo2, hi2 = rng
                if fx is None or not (lo2 - 1e-9 <= fx <= hi2 + 1e-9):
                    range_bad.append("%s[%d]=%s 越界 [%g, %g]"
                                     % (name_, idx, val[idx], lo2, hi2))
        if "enum" in rule and val not in rule["enum"]:
            range_bad.append("%s=%r 不在 %s" % (name_, val, rule["enum"]))

    add("PARAM_RANGE", not range_bad,
        "区间违规：%s" % ("；".join(range_bad) or "无"),
        "每个参数都必须落在任务给定的区间/枚举内")
    return checks


# ------------------------------------------------------------------ 提示词

SYSTEM_PROMPT = """你是 3D 白模配方的生成器。你只输出一份 JSON 配方，不写解释、不写 markdown 代码块。
硬规则：
1. 输出必须是一个 JSON 对象，且能被 json.loads 解析。
2. 字段、类型、区间、命名规则一律照抄任务里给的，不要自创字段。
3. 所有区间约束与结构关系都必须满足——校验器是机器判定，模型自评不算通过。
4. 参数之间要自洽（例如缩放系数与目标尺寸必须对得上，轴距不能超出车长允许范围）。
5. 如果上一轮给了你错误清单，按清单逐条改正，保持其它字段尽量稳定。"""


def _fmt_range(rule: dict[str, Any]) -> str:
    if "ranges" in rule:
        return "逐元素区间 " + " / ".join(
            "[%g, %g]" % (lo, hi) for lo, hi in rule["ranges"])
    if "range" in rule:
        lo, hi = rule["range"]
        return "[%g, %g]" % (lo, hi)
    if "enum" in rule:
        return "其中一个：" + "/".join(str(x) for x in rule["enum"])
    if "fixed" in rule:
        return "固定值 %s" % rule["fixed"]
    return "无额外约束"


def build_user_prompt(task: dict[str, Any],
                      previous_recipe: dict[str, Any] | None = None,
                      hint_chain: list[dict[str, Any]] | None = None) -> str:
    """构造给云端模型的 user 提示（任务规格 + 字段表 + 约束 + 修复上下文）。"""
    lines: list[str] = []
    lines.append("# 任务 %s" % task["task_id"])
    lines.append("类别：%s（%s）" % (task["category"], task.get("category_cn", "")))
    lines.append("资产名必须叫：%s" % task.get("asset_name_hint", "<自己按命名规则起>"))
    lines.append("用途分级：%s（面数预算 %d）" % (task["usage_level"], task["budget_faces"]))
    lines.append("命名规则：%s" % task.get("naming", {}).get("pattern", ""))
    if task.get("naming", {}).get("semantic"):
        lines.append("语义类别：%s（命名首段必须解析到这个类别）"
                     % task["naming"]["semantic"])
    lines.append("")
    lines.append("## 参数表（字段 / 类型 / 约束 / 含义）")
    spec = task.get("fields", {})
    for d in CATEGORY_PARAMS.get(task["category"], []):
        lines.append("- %s | %s | %s | %s"
                     % (d["name"], d["type"], _fmt_range(spec.get(d["name"], {})),
                        d["desc"]))
    if task["category"] == "tree":
        subs = (spec.get("lod") or {}).get("subfields") or {}
        lines.append("  其中 lod 的子字段：%s"
                     % "，".join("%s(%s，%s)"
                                % (k, v, _fmt_range(subs.get(k, {})))
                                for k, v in LOD_FIELDS.items()))
    lines.append("")
    if task.get("relations"):
        lines.append("## 结构关系（机器判定，必须全部满足）")
        for i, rel in enumerate(task["relations"], 1):
            lines.append("%d. %s" % (i, rel["text"]))
        lines.append("")
    lines.append("## 输出格式")
    lines.append("（下面的示例只示范 JSON 结构与字段名，里面的数值是**上一族的基准值**，"
                 "不是本任务的答案：请按本任务的区间重新给值。）")
    lines.append(json.dumps(task.get("example_recipe", {}), ensure_ascii=False, indent=2))
    lines.append("")
    if previous_recipe is not None:
        lines.append("## 上一轮你的配方")
        lines.append(json.dumps(previous_recipe, ensure_ascii=False, indent=2))
        lines.append("")
    if hint_chain:
        lines.append("## 上一轮的错误清单（校验器机器判定，逐条改）")
        for i, h in enumerate(hint_chain, 1):
            lines.append("%d. [%s] %s → %s" % (i, h.get("code", ""),
                                                h.get("message", ""), h.get("hint", "")))
        lines.append("")
        lines.append("只输出改好的 JSON 配方。")
    else:
        lines.append("只输出 JSON 配方。")
    return "\n".join(lines)


def build_hint(checks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把失败项压成结构化 hint（只留 code/message/hint 三元组）。"""
    return [{"code": c.get("code", ""), "message": c.get("message", ""),
             "hint": c.get("hint", "")}
            for c in checks if not c.get("ok")]


def extract_json(text: str) -> tuple[Any, str]:
    """从模型输出里抠出 JSON。返回 (对象, 错误说明)。"""
    if not text:
        return None, "模型返回空内容"
    s = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", s, re.S)
    if fence:
        s = fence.group(1).strip()
    start = s.find("{")
    end = s.rfind("}")
    if start < 0 or end <= start:
        return None, "输出里找不到 JSON 对象"
    blob = s[start:end + 1]
    try:
        return json.loads(blob), ""
    except Exception as exc:
        return None, "JSON 解析失败：%s" % str(exc)[:160]
