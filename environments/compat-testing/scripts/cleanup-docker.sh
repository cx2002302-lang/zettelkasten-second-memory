#!/usr/bin/env bash
# cleanup-docker.sh — compat-testing 容器强制清理（第 2 层关闭保障）
#
# 无论容器由 docker compose 还是 scripts/start-container.sh 启动，
# 本脚本都会强制停止并删除所有 compat-testing 相关容器，确保
# 「不测试时测试环境完全关闭」。
#
# 用法:
#   scripts/cleanup-docker.sh              # 强制停止并删除所有 compat-testing 容器
#   scripts/cleanup-docker.sh --volumes    # 追加：删除 compat-testing 数据卷（⚠️ 丢测试数据）
#   scripts/cleanup-docker.sh --network    # 追加：删除 compat-testing docker 网络
#   scripts/cleanup-docker.sh --dry-run    # 只打印将执行的命令，不实际操作
#
# 建议 cron 每天 03:00 兜底执行（防止忘记 make down 导致测试容器常驻）:
#   0 3 * * * /home/myxia/.openclaw/project/zettelkasten/environments/compat-testing/scripts/cleanup-docker.sh >> /home/myxia/.openclaw/project/zettelkasten/environments/compat-testing/reports/cleanup.log 2>&1

set -euo pipefail

PRUNE_VOLUMES=0
PRUNE_NETWORK=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --volumes) PRUNE_VOLUMES=1 ;;
    --network) PRUNE_NETWORK=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $arg（支持 --volumes / --network / --dry-run / --help）" >&2
      exit 2
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "⚠️  未安装 docker，无需清理，退出。"
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  echo "❌ docker daemon 不可用（无权限或未运行），中止。" >&2
  exit 1
fi

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    echo "==> $*"
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# 收集目标容器（三管齐上，覆盖 compose 与脚本两种启动方式）：
#   1. 已知容器名（含脚本时代遗留）
#   2. label com.zettelkasten.compat-testing=true
#   3. compose 项目 label com.docker.compose.project=compat-testing
# ---------------------------------------------------------------------------
KNOWN_CONTAINERS=(
  "openclaw-latest"
  "openclaw-prod-mirror"
  "hermes-latest"
  "hermes-prod-mirror"
  # 脚本时代遗留名称
  "openclaw-2026-4-23"
  "openclaw-2026-4-24"
)

declare -A SEEN=()
TARGETS=()

add_target() {
  local name="$1"
  [[ -n "$name" ]] || return 0
  if [[ -z "${SEEN[$name]:-}" ]]; then
    SEEN[$name]=1
    TARGETS+=("$name")
  fi
}

for name in "${KNOWN_CONTAINERS[@]}"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    add_target "$name"
  fi
done

while read -r name; do add_target "$name"; done < <(
  docker ps -a --filter "label=com.zettelkasten.compat-testing=true" --format '{{.Names}}'
)
while read -r name; do add_target "$name"; done < <(
  docker ps -a --filter "label=com.docker.compose.project=compat-testing" --format '{{.Names}}'
)

if [[ "${#TARGETS[@]}" -eq 0 ]]; then
  echo "==> 未发现 compat-testing 容器，无需清理。"
else
  echo "==> 将强制停止并删除以下 compat-testing 容器："
  printf '  - %s\n' "${TARGETS[@]}"
  run docker stop --timeout 5 "${TARGETS[@]}" || true
  run docker rm -f "${TARGETS[@]}" || true
fi

# ---------------------------------------------------------------------------
# 可选：数据卷
# ---------------------------------------------------------------------------
if [[ "$PRUNE_VOLUMES" -eq 1 ]]; then
  COMPAT_VOLUMES=(
    "compat-testing_oc-latest-data"
    "compat-testing_oc-2026-4-23-data"
    "compat-testing_oc-2026-4-24-data"
    "compat-testing_hermes-prod-mirror-data"
    "compat-testing_hermes-latest-data"
    "hermes-latest-data"
  )
  echo "⚠️  --volumes：将删除以下 compat-testing 数据卷（存在才删）"
  for vol in "${COMPAT_VOLUMES[@]}"; do
    if docker volume inspect "$vol" >/dev/null 2>&1; then
      run docker volume rm "$vol" || true
    fi
  done
fi

# ---------------------------------------------------------------------------
# 可选：网络
# ---------------------------------------------------------------------------
if [[ "$PRUNE_NETWORK" -eq 1 ]]; then
  for net in compat-testing compat-testing_default; do
    if docker network inspect "$net" >/dev/null 2>&1; then
      run docker network rm "$net" || true
    fi
  done
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] 未实际操作。"
else
  echo "✅ compat-testing 清理完成。"
fi
