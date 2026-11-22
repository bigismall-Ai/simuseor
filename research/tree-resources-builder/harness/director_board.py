#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R5 · 最小导演台（只读本地）——脚本入口别名。

看板生成本体在 harness/board.py（对应 plans/ROADMAP-IMAGE-VIDEO.md §4 R5 的交付物
「harness/board.py」）。本文件只是同义入口，方便按「导演台 / director_board」的习惯叫法调用：
    python3 harness/director_board.py        # 生成 boards/shot_board.html
    python3 harness/director_board.py --check # 只跑一遍验收（等价 harness/verify_board.py）
"""
from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main(argv):
    if "--check" in argv:
        cmd = [sys.executable, os.path.join(HERE, "verify_board.py")]
    else:
        cmd = [sys.executable, os.path.join(HERE, "board.py")]
    return subprocess.call(cmd)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
