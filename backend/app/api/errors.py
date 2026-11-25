"""稳定的机器可读错误码。

约定：
- `ApiError` 继承 `HTTPException`，额外带一个 `code`；全局处理器把它渲染成
  `{"detail": "...", "code": "..."}`。
- 没有 `code` 的旧 `HTTPException` 仍然只返回 `{"detail": "..."}`，
  保证既有客户端不受影响。
"""
from __future__ import annotations

from enum import Enum

from fastapi import HTTPException


class ErrorCode(str, Enum):
    """不能随便改名：前端与外部客户端按字符串比较。"""

    INVALID_SOURCE = "invalid_source"
    """下载源未配置 / 不可识别。"""

    INVALID_REQUEST = "invalid_request"
    """参数本身不合法（路径越界之外的格式 / 状态问题）。"""

    NOT_FOUND = "not_found"
    """目标资源不存在。"""

    CONFLICT = "conflict"
    """并发冲突，例如乐观锁 mtime 已变化。"""

    FORBIDDEN = "forbidden"
    """操作被允许范围拒绝（路径越界、目录受限）。"""

    SOURCE_UNAVAILABLE = "source_unavailable"
    """外部依赖不可达：节点清单、发现源、前端产物等。"""

    FILESYSTEM_ERROR = "filesystem_error"
    """本机文件系统错误：目录改名失败、路径已消失等。"""


class ApiError(HTTPException):
    """带错误码的 `HTTPException`。"""

    def __init__(self, status_code: int, detail: str, code: ErrorCode | str):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code.value if isinstance(code, ErrorCode) else str(code)
