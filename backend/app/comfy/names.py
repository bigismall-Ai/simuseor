"""实例名校验。

实例名会直接拼进 `comfy/<name>/` 路径，也会进日志文件名，所以必须是单层
名字：不允许分隔符、不允许 `.` / `..`、不允许前导符号。安装、启动、删除
三条入口都走这里，避免只有删除端点做了校验。
"""
from __future__ import annotations

import re

INSTANCE_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")


def validate_instance_name(name: str) -> str:
    """校验并返回规范化后的实例名；不合法时抛 ValueError（API 层转 400）。"""
    value = (name or "").strip()
    if not value:
        raise ValueError("实例名不能为空")
    if not INSTANCE_NAME_RE.fullmatch(value):
        raise ValueError("实例名不合法：只能用字母、数字、点、下划线、短横线，且不能以符号开头")
    return value


#: 显示名上限：够写「ComfyUI 主力 · 工作流测试」这种，再长在列表里就会换行
ALIAS_MAX = 40


def clean_alias(alias: str) -> str:
    """规范化实例显示名；空串表示没有别名，界面回落显示目录名。

    与 `validate_instance_name` 分开：目录名要拼路径、必须保守；显示名只进
    JSON 和界面，中文、空格、括号都该允许，只挡控制字符和超长。
    """
    value = re.sub(r"\s+", " ", (alias or "").strip())
    value = "".join(ch for ch in value if ch.isprintable())
    if len(value) > ALIAS_MAX:
        raise ValueError(f"名称最多 {ALIAS_MAX} 个字符")
    return value
