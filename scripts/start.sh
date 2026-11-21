#!/usr/bin/env bash
# 一键启动：环境检查 → 按需构建前端 → 起后端 → 等待健康 → 打开浏览器
# 用法: bash scripts/start.sh [--build] [--no-build] [--restart] [--no-open] [--dev]
#   --build      强制重建前端（默认：产物缺失或源码比产物新时自动构建）
#   --no-build   跳过构建检查，直接用现有 web/dist
#   --restart    强制重启（停掉占用端口的旧进程）
#   --no-open    不自动打开浏览器
#   --dev        开发模式：后端开热重载(8000) + 前端 dev server(4200，HMR)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

BUILD=auto          # auto | yes | no
RESTART=0
OPEN=1
DEV=0

usage() {
  cat <<'EOF'
用法: bash scripts/start.sh [选项]

  --build       强制重建前端（默认：产物缺失或源码比产物新时自动构建）
  --no-build    跳过构建检查，直接用现有 web/dist
  --restart     强制重启（先停掉占用 8000 的旧进程）
  --no-open     不自动打开浏览器
  --dev         开发模式：后端热重载(8000) + 前端 dev server(4200, HMR)
  -h, --help    显示帮助

无参数：一条命令起服务，Ctrl+C 停止。本机 http://127.0.0.1:8000；局域网 http://<本机IP>:8000
--dev  ：本机 http://127.0.0.1:4200；局域网 http://<本机IP>:4200（改前端即时生效，改后端自动重启）
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --build)    BUILD=yes; shift ;;
    --no-build) BUILD=no;  shift ;;
    --restart)  RESTART=1; shift ;;
    --no-open)  OPEN=0;    shift ;;
    --dev)      DEV=1;     shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# 本机 127.0.0.1 请求绝不能走系统代理（否则 /health、aria2 RPC 会被接走）
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY=127.0.0.1,localhost
if [ -z "${PYTHONPATH:-}" ]; then export PYTHONPATH="$ROOT/backend"; fi

if [ -x "$ROOT/.venv/Scripts/python.exe" ]; then
  PY="$ROOT/.venv/Scripts/python.exe"
elif [ -x "$ROOT/.venv/bin/python" ]; then
  PY="$ROOT/.venv/bin/python"
else
  echo "找不到虚拟环境。先执行：python -m venv .venv && .venv/Scripts/pip install -r backend/requirements.txt" >&2
  exit 1
fi

PORT=$("$PY" -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        print(int(json.load(f).get("app", {}).get("port", 8000)))
except Exception:
    print(8000)
' "$ROOT/var/data/settings.json")
URL="http://127.0.0.1:$PORT"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(ipconfig 2>/dev/null | awk '/IPv4/ {print $NF; exit}' | tr -d '\r')"
fi
LAN_URL="http://${LAN_IP:-<本机IP>}:$PORT"

# 注意：/health 会被 SPA fallback 吞掉返回 index.html（假 200），必须用 /api/health
if command -v curl >/dev/null 2>&1; then
  health() {
    local body
    body="$(curl -fsS --noproxy '*' --max-time 2 "$URL/api/health" 2>/dev/null || true)"
    case "$body" in *'"status":"ok"'*|*'"status": "ok"'*) return 0 ;; *) return 1 ;; esac
  }
else
  health() {
    "$PY" -c "
import json, sys, urllib.request
try:
    with urllib.request.urlopen('$URL/api/health', timeout=2) as r:
        sys.exit(0 if json.load(r).get('status') == 'ok' else 1)
except Exception:
    sys.exit(1)
" >/dev/null 2>&1
  }
fi

# 返回占用端口的 PID（Windows Git Bash 用 netstat，Unix 用 lsof）
port_pid() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      netstat -ano 2>/dev/null | awk -v port="$PORT" \
        'toupper($4)=="LISTENING" && $2 ~ (":" port "$") { print $5; exit }' ;;
    *)
      if command -v lsof >/dev/null 2>&1; then
        lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1
      fi ;;
  esac
}

kill_pid() {
  [ -n "${1:-}" ] || return 0
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) taskkill //PID "$1" //F >/dev/null 2>&1 || kill -9 "$1" 2>/dev/null || true ;;
    *) kill -9 "$1" 2>/dev/null || true ;;
  esac
}

open_browser() {
  "$PY" -c "import sys, webbrowser; webbrowser.open(sys.argv[1])" "$URL" >/dev/null 2>&1 &
}

# ---- 前端产物 ----
# dev 模式不需要 dist：前端 dev server 自己编译，且带 HMR
DIST="$ROOT/web/dist/browser/index.html"
need_build=0
if [ "$DEV" = 1 ]; then
  :
elif [ "$BUILD" = yes ]; then
  need_build=1
elif [ "$BUILD" = no ]; then
  need_build=0
elif [ ! -f "$DIST" ]; then
  echo "→ 前端产物缺失，自动构建"
  need_build=1
elif [ -n "$(find "$ROOT/web/src" "$ROOT/web/public" "$ROOT/web/angular.json" "$ROOT/web/package.json" -type f -newer "$DIST" -print -quit 2>/dev/null)" ]; then
  echo "→ 检测到前端源码更新，自动构建"
  need_build=1
fi

if [ "$need_build" = 1 ]; then
  command -v npm >/dev/null 2>&1 || { echo "找不到 npm，无法构建前端" >&2; exit 1; }
  rm -rf "$ROOT/web/dist"     # ng build 会假成功，必须先清空产物
  (cd "$ROOT/web" && npm run build) || { echo "前端构建失败" >&2; exit 1; }
  [ -f "$DIST" ] || { echo "构建后仍找不到 $DIST" >&2; exit 1; }
  echo "✔ 前端已构建"
fi

# ---- 旧实例 ----
if health; then
  if [ "$RESTART" = 0 ]; then
    echo "✔ 服务已在运行：$URL （要重启请加 --restart；局域网访问需重启到 0.0.0.0）"
    if [ "$OPEN" = 1 ]; then open_browser; fi
    exit 0
  fi
  echo "→ --restart：停止旧服务"
fi
OLD_PID="$(port_pid || true)"
if [ -n "$OLD_PID" ]; then
  if [ "$RESTART" = 1 ]; then
    echo "→ 清理占用 $PORT 的进程 $OLD_PID"
    kill_pid "$OLD_PID"
    sleep 1
  else
    echo "端口 $PORT 被进程 $OLD_PID 占用且 /api/health 无响应；加 --restart 强制重启" >&2
    exit 1
  fi
fi

# ---- 启动 ----
if [ "$DEV" = 1 ]; then
  DEV_PORT=4200
  DEV_URL="http://127.0.0.1:$DEV_PORT"
  DEV_LAN_URL="http://${LAN_IP:-<本机IP>}:$DEV_PORT"

  # 旧的 8000 / 4200 都要清掉，否则端口被占，两个服务都起不来
  for P in "$PORT" "$DEV_PORT"; do
    OLD="$(netstat -ano 2>/dev/null | awk -v port="$P" \
      'toupper($4)=="LISTENING" && $2 ~ (":" port "$") { print $5; exit }')"
    if [ -n "$OLD" ]; then
      echo "→ 清理占用 $P 的旧进程 $OLD"
      taskkill //PID "$OLD" //T //F >/dev/null 2>&1 || kill -9 "$OLD" 2>/dev/null || true
    fi
  done
  sleep 1

  echo "→ 启动后端（热重载）：$URL"
  RELOAD=1 "$PY" backend/run.py &
  SERVER_PID=$!

  echo "→ 启动前端 dev server：$DEV_URL"
  # host/port 由 web/package.json 的 start 固定为 0.0.0.0:4200，避免重复传参
  (cd "$ROOT/web" && npm start) &
  WEB_PID=$!

  cleanup() {
    kill "$SERVER_PID" "$WEB_PID" 2>/dev/null || true
    # Windows 上 npm start 会再拉一层 node 子进程，得连树一起杀
    taskkill //PID "$WEB_PID" //T //F >/dev/null 2>&1 || true
    taskkill //PID "$SERVER_PID" //T //F >/dev/null 2>&1 || true
  }
  trap cleanup INT TERM EXIT

  for _ in $(seq 1 120); do
    if health; then break; fi
    kill -0 "$SERVER_PID" 2>/dev/null || { echo "后端进程提前退出" >&2; exit 1; }
    sleep 0.5
  done
  if ! health; then
    echo "等待后端 /api/health 超时（60s）" >&2
    exit 1
  fi

  echo "✔ 后端已就绪：$URL （改后端 .py 自动重启）"
  echo "✔ 前端开发地址：$DEV_URL （改前端即时生效）"
  echo "✔ 局域网访问：$DEV_LAN_URL"
  echo "  如果局域网仍打不开，请在防火墙放行 TCP $DEV_PORT 与 $PORT"
  if [ "$OPEN" = 1 ]; then
    "$PY" -c "import sys, webbrowser; webbrowser.open(sys.argv[1])" "$DEV_URL" >/dev/null 2>&1 &
  fi
  wait
  exit 0
fi

echo "→ 启动后端：$URL"
"$PY" backend/run.py &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup INT TERM EXIT

for _ in $(seq 1 80); do
  if health; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "后端进程提前退出" >&2; exit 1; }
  sleep 0.5
done
if ! health; then
  echo "等待 /api/health 超时（40s）" >&2
  exit 1
fi

echo "✔ 已就绪：$URL   （Ctrl+C 停止服务）"
echo "✔ 局域网访问：$LAN_URL"
echo "  如果局域网仍打不开，请在防火墙放行 TCP $PORT"
if [ "$OPEN" = 1 ]; then open_browser; fi
wait "$SERVER_PID"
