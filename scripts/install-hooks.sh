#!/usr/bin/env bash
# 安装厂标资产的提交前门禁。
#
# 用法：bash scripts/install-hooks.sh
#
# 为什么不是直接往 .git/hooks/ 里拷：
#   .git/ 不进版本库，拷进去换台机器就没了。而 hook 脚本本身是长期资产
#   （仓库里有文档引用它），所以脚本进版本库，这里只负责接线。
#
# 接线方式用 git config core.hooksPath —— 这是**本地**配置，每个开发者跑一次。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ PATH 里没有 node —— 门禁需要 node 才能跑" >&2
  exit 1
fi

mkdir -p "$ROOT/scripts/hooks"
chmod +x "$ROOT/scripts/hooks/pre-commit"

git config core.hooksPath "$ROOT/scripts/hooks"

echo "✓ 已安装厂标资产门禁"
echo "    core.hooksPath = $(git config core.hooksPath)"
echo "    临时跳过：SKIP=1 git commit -m \"...\""
echo "    卸载：git config --unset core.hooksPath"
