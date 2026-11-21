"""ModelScope 源：解析必须走递归文件列表。

背景：`/repo/files?Root=` 默认只返回顶层条目，folder 条目里没有 Children。
旧代码据此递归，结果 text_encoder/ transformer/ 下的权重整段丢失，
MiniMax-H3-Image 只剩根目录的 pdd_fused_heads.safetensors。
"""
from __future__ import annotations

import json

import httpx

from app.sources import modelscope as ms


def _resp(payload: dict) -> httpx.Response:
    return httpx.Response(
        status_code=200,
        content=json.dumps(payload).encode("utf-8"),
        request=httpx.Request("GET", "https://modelscope.cn/api/v1/models/a/b/repo/files"),
    )


def test_resolve_uses_recursive_flat_list(monkeypatch):
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _resp(
            {
                "Data": {
                    "Files": [
                        {"Type": "tree", "Name": "text_encoder", "Path": "text_encoder", "Size": 0},
                        {
                            "Type": "blob",
                            "Name": "model-00001-of-00014.safetensors",
                            "Path": "text_encoder/model-00001-of-00014.safetensors",
                            "Size": 4703,
                        },
                        {
                            "Type": "blob",
                            "Name": "model.safetensors",
                            "Path": "model.safetensors",
                            "Size": 123,
                        },
                    ]
                }
            }
        )

    monkeypatch.setattr(ms.httpx, "get", fake_get)
    info = ms.ModelScopeAdapter().resolve("a/b", "master", {})

    assert seen["params"]["Recursive"] == "true"
    paths = [f.path for f in info.files]
    assert "text_encoder/model-00001-of-00014.safetensors" in paths
    assert "model.safetensors" in paths
    assert "text_encoder" not in paths  # 目录本身不是文件
