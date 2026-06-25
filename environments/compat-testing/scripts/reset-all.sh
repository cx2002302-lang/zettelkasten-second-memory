#!/bin/bash
#
# 重置所有兼容测试环境（删除所有 named volume 与容器）
#

set -e

cd "$(dirname "$0")/.."

echo "WARNING: This will delete all OpenClaw / Hermes test data."
read -r -p "Are you sure? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

for container in openclaw-2026-4-23 openclaw-2026-4-24 openclaw-latest hermes-latest; do
  docker rm -f "$container" 2>/dev/null || true
done

for vol in compat-testing_oc-2026-4-23-data compat-testing_oc-2026-4-24-data compat-testing_oc-latest-data hermes-latest-data; do
  docker volume rm "$vol" 2>/dev/null || true
done

echo "==> All environments reset. Run start-container.sh + deploy-zk-to-container.sh for each OpenClaw instance."
