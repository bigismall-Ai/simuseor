"""封面选取：Civitai 的 modelVersions[].images 里挑一张当卡片背景。"""
from __future__ import annotations

from app.sources.civitai import pick_cover


def img(url: str, width: int = 1024, height: int = 768, level: int = 1, kind: str = "image") -> dict:
    return {"url": url, "width": width, "height": height, "nsfwLevel": level, "type": kind}


def versions(*image_lists: list[dict]) -> list[dict]:
    return [{"images": imgs} for imgs in image_lists]


def test_prefers_landscape_over_portrait_first_image():
    """首图是 576×1024 竖版，铺进 4:3 卡面要裁掉近一半高度，应该选后面的横版。"""
    got = pick_cover(versions([img("portrait", 576, 1024), img("landscape", 1024, 768)]))
    assert got == "landscape"


def test_picks_ratio_closest_to_card():
    got = pick_cover(
        versions([img("wide", 1920, 600), img("four-three", 1024, 768), img("square", 800, 800)])
    )
    assert got == "four-three"


def test_skips_video_entries():
    """图集里混着视频，`<img>` 拿到视频 URL 会直接坏图。"""
    got = pick_cover(versions([img("clip", kind="video"), img("still", 1024, 768)]))
    assert got == "still"


def test_ignores_non_pg_by_default():
    """默认只给 PG（nsfwLevel=1）；只有非 PG 图时不返回封面，交给家族铭牌。"""
    assert pick_cover(versions([img("mature", level=4)])) == ""
    assert pick_cover(versions([img("soft", level=2)])) == ""


def test_full_catalog_falls_back_to_non_pg():
    got = pick_cover(versions([img("mature", level=4)]), allow_mature=True)
    assert got == "mature"


def test_full_catalog_still_prefers_pg():
    """完整目录只是「允许」，不是「优先」——有一张 PG 就不该把成熟内容顶到卡面上。"""
    got = pick_cover(
        versions([img("mature", 1024, 768, level=8), img("portrait", 600, 1000)]),
        allow_mature=True,
    )
    assert got == "portrait"


def test_image_without_dimensions_is_kept_as_last_resort():
    got = pick_cover(versions([{"url": "unknown", "nsfwLevel": 1, "type": "image"}]))
    assert got == "unknown"


def test_empty_versions_returns_blank():
    assert pick_cover([]) == ""
    assert pick_cover(versions([])) == ""
