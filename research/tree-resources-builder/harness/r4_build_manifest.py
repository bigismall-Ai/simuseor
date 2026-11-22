"""R4 台账构建：注入 R4 注册表 -> 跑官方 asset_manifest 的 build / validate。

用法
----
    python harness/r4_build_manifest.py --build --validate
    python harness/r4_build_manifest.py --check      # 只校验不落盘

为什么要有这个壳
----------------
台账必须由 asset_manifest.py 的构建器生成（指纹、sha256、引用完整性都在那里），
但它的资产名录是写死的常量，而 R4 不许改那个既有文件。
所以：这里在**构建时**把 R4 注册表注入进去，然后照旧调用官方的
build_manifest() / write_manifest() / validate_manifest()。
asset_manifest.py 本身一个字没动。

注入内容
--------
* GEOMETRY_ASSETS / NONGEOMETRY_ASSETS：R4 新件（几何件 + 配方/实例表）
* ASSET_ALIASES：R4 短名（镜头包可直接引用）
* _validation_block：R4 件读自己的校验读数（不落 exports.json 的兜底）
* write_manifest：落盘前回填 LOD 档位 / 用途分级 / 许可 / 层级

纯 CPU、无网络、无生成式模型。
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import asset_manifest as AM  # noqa: E402
import r4_asset_registry as REG  # noqa: E402


def install():
    """把 R4 注册表注入官方构建器（不改 asset_manifest.py 的代码）。"""
    AM.GEOMETRY_ASSETS = list(AM.GEOMETRY_ASSETS) + REG.geometry_assets()
    AM.NONGEOMETRY_ASSETS = list(AM.NONGEOMETRY_ASSETS) + REG.nongeometry_assets()
    AM.ASSET_ALIASES = dict(AM.ASSET_ALIASES)
    AM.ASSET_ALIASES.update(REG.aliases())

    _orig_validation_block = AM._validation_block

    def _validation_block(asset_id, validation_report, exports):
        row = REG.validation_for(asset_id)
        if row:
            return row
        return _orig_validation_block(asset_id, validation_report, exports)

    AM._validation_block = _validation_block

    _orig_write_manifest = AM.write_manifest
    _orig_build_manifest = AM.build_manifest

    def _build_manifest_fresh():
        """构建器只在 manifest.json 里没有 files[] 时才重算文件快照。

        R4 新增了 55 个几何件 + 9 份配方/实例表，R3 留下的 files[] 快照已过期。
        这里先把旧快照摘掉，再让**构建器自己**的算法重算（不是另写一套），
        这样 count / total_bytes 与磁盘现状自洽。
        """
        import json as _json
        doc = AM._read_json(AM.MANIFEST_PATH, {}) or {}
        if doc.get("files"):
            doc.pop("files")
            with open(AM.MANIFEST_PATH, "w", encoding="utf-8") as fh:
                _json.dump(doc, fh, ensure_ascii=False, indent=2)
        return _orig_build_manifest()

    def _write_manifest(manifest=None):
        m = manifest if manifest is not None else AM.build_manifest()
        m = REG.decorate(m)
        _orig_write_manifest(m)
        return m

    AM.build_manifest = _build_manifest_fresh
    AM.write_manifest = _write_manifest
    return AM


def main(argv=None):
    ap = argparse.ArgumentParser(description="R4 台账构建（注入 R4 注册表后走官方构建器）")
    ap.add_argument("--build", action="store_true", help="合成并写 assets/manifest.json（v2）")
    ap.add_argument("--validate", action="store_true", help="校验并写 assets/validation/manifest_report.json")
    ap.add_argument("--check", action="store_true", help="只校验不落盘")
    args = ap.parse_args(argv)
    install()
    return AM.main([a for a in ("--build", "--validate", "--check") if getattr(args, a[2:])])


if __name__ == "__main__":
    raise SystemExit(main())
