"""节点扩展的用途分类：词边界、主类型、筛选与分面计数。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import nodes
from app.node_categories import CATEGORIES, category_of


@pytest.mark.parametrize(
    "name,desc,nodes_list,expected",
    [
        ("Flux prompt generator", "generate prompts for flux", [], "text_to_image"),
        ("ComfyUI-Advanced-ControlNet", "controlnet preprocessors", [], "controlnet"),
        ("AceStep audio nodes", "text to speech and music", [], "audio"),
        ("ComfyUI-VideoHelperSuite", "load and combine video", ["VHS_VideoCombine"], "video"),
        ("Text2Video nodes", "text to video generation", [], "text_to_video"),
        ("Basic data handling", "BOOLEAN, FLOAT, INT, STRING", [], "utility"),
    ],
)
def test_category_of(name, desc, nodes_list, expected):
    assert category_of(name, desc, nodes_list) == expected


def test_short_keywords_need_word_boundary():
    """裸子串会让 sam 命中 sampler，分类就失意义了。"""
    assert category_of("Sampler Experiments", "various sampler settings") == "utility"
    assert category_of("SAM Segmenter", "segment anything") == "segment"


def test_description_wins_over_class_name_noise():
    """267 个节点类名里带 t2i/i2v 不该把视频扩展判成文生图。"""
    assert (
        category_of(
            "VRGameDevGirl Video Enhancement Nodes",
            "frame-by-frame video enhancement",
            ["T2IAdapter", "I2VHandler"],
        )
        == "video"
    )


def test_falls_back_to_classes_when_description_says_nothing():
    assert category_of("Some Pack", "misc helpers", ["ControlNetApply"]) == "controlnet"


def test_prefers_more_specific_signal():
    # 同时出现 video(1) 与 text to video(3)，应判文生视频
    assert category_of("text to video", "video generation") == "text_to_video"


def _fake_catalog():
    items = [
        {"id": "a/x", "name": "Flux tools", "author": "a", "repo": "https://x/a",
         "source": "manager", "description": "", "tags": [], "nodes": [], "node_count": 10,
         "install_type": "git-clone", "installable": True, "preemptions": [], "needs": [],
         "mirror": "", "category": "text_to_image"},
        {"id": "b/y", "name": "ControlNet pack", "author": "b", "repo": "https://x/b",
         "source": "manager", "description": "", "tags": [], "nodes": [], "node_count": 5,
         "install_type": "git-clone", "installable": True, "preemptions": [], "needs": [],
         "mirror": "", "category": "controlnet"},
        {"id": "c/z", "name": "Utility", "author": "c", "repo": "https://x/c",
         "source": "manager", "description": "", "tags": [], "nodes": [], "node_count": 1,
         "install_type": "git-clone", "installable": True, "preemptions": [], "needs": [],
         "mirror": "", "category": "utility"},
    ]
    return {"items": items, "by_id": {i["id"]: i for i in items}}


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(nodes, "catalog", _fake_catalog)
    monkeypatch.setattr(nodes, "installed", lambda: [])
    return _fake_catalog()


def test_search_filters_by_category(fake):
    out = nodes.search(category="controlnet")
    assert out["total"] == 1
    assert out["items"][0]["id"] == "b/y"


def test_facet_counts_ignore_current_filter(fake):
    out = nodes.search(category="controlnet")
    counts = {c["id"]: c["count"] for c in out["categories"]}
    # 切到 ControlNet 之后，其它分类的数量不该归零
    assert counts["text_to_image"] == 1
    assert counts["utility"] == 1
    assert counts["controlnet"] == 1
    # 分类顺序固定，前端 chips 顺序稳定
    assert [c["id"] for c in out["categories"]] == [cid for cid, _ in CATEGORIES]
