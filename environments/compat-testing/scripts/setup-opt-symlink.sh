#!/bin/bash
#
# 将当前兼容测试环境链接到 /opt/zettelkasten-compat
# 需要 root 权限运行（通常用 sudo）
#

set -e

SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="/opt/zettelkasten-compat"

if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo: sudo $0"
  exit 1
fi

mkdir -p /opt
ln -sfn "$SOURCE" "$TARGET"

echo "==> Symlink created: $TARGET -> $SOURCE"
echo "    You can now run tests from $TARGET"
