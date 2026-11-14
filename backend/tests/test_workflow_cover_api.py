"""封面 HTTP 端点的入参校验与返回形状。

业务判定在 workflow_covers 里测，这里只管「端点有没有把错误变成 400、
有没有把 pinned / custom 一起回给前端」——界面靠这两个数组判断封面来源。
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import workflow_covers as wc
from app.api import routes


@pytest.fixture(autouse=True)
def _clean_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "COVERS_PATH", tmp_path / "covers.json")
    monkeypatch.setattr(wc, "BLOB_DIR", tmp_path / "blobs")
    wc.reset_cache()
    yield
    wc.reset_cache()


def test_batch_returns_pinned_and_custom_lists():
    assert routes.workflow_covers(routes.WorkflowCoversRequest(items=[])) == {
        "covers": {}, "pinned": [], "custom": [],
    }

    wc.pin("a.json", "https://x/manual.jpg", source="manual")
    wc.set_custom("b.json", url="https://img.example/mine.png")
    out = routes.workflow_covers(routes.WorkflowCoversRequest(items=[]))
    assert out["pinned"] == ["a.json", "b.json"]
    assert out["custom"] == ["b.json"]


def test_custom_endpoint_accepts_url_and_rejects_bad_scheme():
    out = routes.set_custom_workflow_cover(
        routes.WorkflowCoverCustomRequest(key="a.json", url="https://img.example/a.png")
    )
    assert out == {
        "key": "a.json", "cover": "https://img.example/a.png",
        "pinned": True, "source": "custom",
    }

    with pytest.raises(HTTPException) as bad:
        routes.set_custom_workflow_cover(
            routes.WorkflowCoverCustomRequest(key="a.json", url="javascript:alert(1)")
        )
    assert bad.value.status_code == 400


def test_reset_endpoint_clears_pin_and_manual_result():
    wc.set_custom("a.json", url="https://img.example/a.png")
    assert wc.pinned("a.json")

    out = routes.reset_workflow_cover(routes.WorkflowCoverResetRequest(key="a.json"))
    assert out == {"key": "a.json", "pinned": False}
    assert wc.pinned("a.json") == ""
    assert wc.custom_keys() == []


def test_refresh_endpoint_returns_source(monkeypatch):
    # 只验返回形状，重抽的发牌逻辑在 test_workflow_covers.py
    monkeypatch.setattr(wc, "redeal", lambda entry, current: "https://x/new.jpg")
    out = routes.refresh_workflow_cover(
        routes.WorkflowCoverRefreshRequest(key="a.json", current="https://x/old.jpg")
    )
    assert out == {
        "key": "a.json", "cover": "https://x/new.jpg",
        "pinned": True, "source": "manual",
    }
