#!/usr/bin/env bash
# 装依赖，但 node_modules 放在工作区外（/var/tmp/game2-deps），项目里只留一个软链接。
# 原因：沙盒工作区有容量上限（见 /home/user/SANDBOX.md）。本地开发直接 npm install 即可，不需要这个脚本。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS=/var/tmp/game2-deps
mkdir -p "$DEPS"
cp "$ROOT/package.json" "$DEPS/"
[ -f "$ROOT/package-lock.json" ] && cp "$ROOT/package-lock.json" "$DEPS/"
(cd "$DEPS" && npm install --no-audit --no-fund --loglevel=error "$@")
cp "$DEPS/package.json" "$ROOT/package.json"
cp "$DEPS/package-lock.json" "$ROOT/package-lock.json"
if [ ! -L "$ROOT/node_modules" ]; then rm -rf "$ROOT/node_modules"; ln -s "$DEPS/node_modules" "$ROOT/node_modules"; fi
echo "依赖就绪：$(readlink "$ROOT/node_modules")"
