#!/bin/bash
#
# 重置所有兼容测试环境（删除所有 named volume）
#

set -e

cd "$(dirname "$0")/.."

echo "WARNING: This will delete all OpenClaw / Hermes test data."
read -r -p "Are you sure? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

docker compose down -v
docker compose up -d

echo "==> All environments reset. Run onboard + deploy scripts for each OpenClaw instance."
