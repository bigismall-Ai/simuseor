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
    wc._CANDIDATES.clear()
    yield
    wc.reset_cache()
    wc._CANDIDATES.clear()


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


def test_candidates_endpoint_returns_batch_without_pin(monkeypatch):
    urls = ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"]
    monkeypatch.setattr(wc, "candidates", lambda entry, current, offset: urls)
    out = routes.workflow_cover_candidates(
        routes.WorkflowCoverCandidatesRequest(key="a.json", current=urls[0], offset=1)
    )
    assert out == {"key": "a.json", "covers": urls}
    assert wc.pinned("a.json") == ""


def test_candidates_and_choose_only_accept_offered_urls(monkeypatch):
    urls = ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg", "https://x/4.jpg"]
    monkeypatch.setattr(wc, "_workflow_cover", lambda name, cfg: "")
    monkeypatch.setattr(wc, "_cached_pool", lambda model, cfg: urls)

    offered = wc.candidates({"key": "a.json", "model": "flux"}, current="https://x/current.jpg")
    assert offered == urls
    # 发候选不能偷偷改掉当前封面
    assert wc.pinned("a.json") == ""

    out = routes.choose_workflow_cover(
        routes.WorkflowCoverChooseRequest(key="a.json", url=urls[1])
    )
    assert out == {
        "key": "a.json", "cover": urls[1], "pinned": True, "source": "manual",
    }
    assert wc.pinned("a.json") == urls[1]

    # 当前图也在允许列表里（画廊会把它摆在第一格）
    cur = routes.choose_workflow_cover(
        routes.WorkflowCoverChooseRequest(key="a.json", url="https://x/current.jpg")
    )
    assert cur["cover"] == "https://x/current.jpg"

    with pytest.raises(HTTPException) as bad:
        routes.choose_workflow_cover(
            routes.WorkflowCoverChooseRequest(key="a.json", url="https://evil.example/x.jpg")
        )
    assert bad.value.status_code == 400


def test_candidates_offset_rotates_without_new_request(monkeypatch):
    urls = ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg", "https://x/4.jpg"]
    monkeypatch.setattr(wc, "_workflow_cover", lambda name, cfg: "")
    monkeypatch.setattr(wc, "_cached_pool", lambda model, cfg: urls)
    first = wc.candidates({"key": "a.json", "model": "flux"})
    second = wc.candidates({"key": "a.json", "model": "flux"}, offset=4)
    assert first == second  # 一圈转回来，且没有重新搜社区
    third = wc.candidates({"key": "a.json", "model": "flux"}, offset=1)
    assert third[0] != first[0]
