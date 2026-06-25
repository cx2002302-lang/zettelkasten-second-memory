#!/bin/bash
#
# 在代理连接不稳定时反复尝试 docker pull，直到成功或达到最大重试次数
#

set -e

IMAGE="${1:-}"
MAX_RETRIES="${2:-10}"

if [ -z "$IMAGE" ]; then
  echo "Usage: $0 <image> [max_retries]"
  exit 1
fi

for i in $(seq 1 "$MAX_RETRIES"); do
  echo "==> Pull attempt $i/$MAX_RETRIES: $IMAGE"
  if sg docker -c "docker pull '$IMAGE'"; then
    echo "==> Success: $IMAGE"
    exit 0
  fi
  echo "==> Failed, retrying in 10s..."
  sleep 10
done

echo "==> Max retries reached for $IMAGE"
exit 1
