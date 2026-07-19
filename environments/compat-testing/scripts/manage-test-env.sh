#!/bin/bash
#
# 一键检测 / 关闭 / 重启兼容测试环境容器
#
# Usage:
#   bash scripts/manage-test-env.sh status      # 查看状态（默认）
#   bash scripts/manage-test-env.sh stop        # 停止所有测试容器
#   bash scripts/manage-test-env.sh stop -r     # 停止并删除容器
#   bash scripts/manage-test-env.sh stop -v     # 停止并删除容器 + 数据卷（危险）
#   bash scripts/manage-test-env.sh restart     # 重启所有测试容器
#   bash scripts/manage-test-env.sh logs <name> # 查看指定容器日志
#

set -e

TEST_CONTAINERS=(
  "openclaw-prod-mirror"
  "openclaw-latest"
  "hermes-prod-mirror"
  "hermes-latest"
  # 脚本时代遗留名称（可能仍存在）
  "openclaw-2026-4-23"
  "openclaw-2026-4-24"
)

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cmd="${1:-status}"

show_status() {
  echo "==> 兼容测试容器状态"
  printf "%-22s %-12s %-10s %s\n" "Container" "Status" "Health" "Ports"
  printf "%-22s %-12s %-10s %s\n" "--------" "------" "------" "-----"

  local any_running=false
  for c in "${TEST_CONTAINERS[@]}"; do
    local info
    info=$(docker ps -a --filter "name=^/${c}$" --format '{{.Status}}|{{.Ports}}' 2>/dev/null || true)
    if [ -z "$info" ]; then
      printf "%-22s %-12s %-10s %s\n" "$c" "NOT EXISTS" "" ""
    else
      any_running=true
      local status ports health
      status=$(echo "$info" | cut -d'|' -f1)
      ports=$(echo "$info" | cut -d'|' -f2)
      if echo "$status" | grep -q "healthy"; then
        health="healthy"
      elif echo "$status" | grep -q "unhealthy"; then
        health="unhealthy"
      else
        health="-"
      fi
      printf "%-22s %-12s %-10s %s\n" "$c" "$status" "$health" "$ports"
    fi
  done

  if [ "$any_running" = false ]; then
    echo ""
    echo "所有测试容器均未运行。"
  fi

  echo ""
  echo "==> 相关数据卷"
  docker volume ls --format '{{.Name}}' | grep -E 'compat-testing_(oc|hermes)|hermes-latest-data|hermes-prod-mirror-data' || true
}

stop_containers() {
  local remove=false
  local remove_volumes=false
  local auto_confirm=false

  while [ "$#" -gt 0 ]; do
    case "$1" in
      -r|--remove) remove=true ;;
      -v|--volumes) remove=true; remove_volumes=true ;;
      -y|--yes) auto_confirm=true ;;
      *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
  done

  echo "==> 即将停止以下测试容器："
  for c in "${TEST_CONTAINERS[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
      echo "  - $c"
    fi
  done

  if [ "$remove" = true ]; then
    echo ""
    echo "⚠️  同时会删除容器。"
  fi
  if [ "$remove_volumes" = true ]; then
    echo "⚠️  同时会删除 named volume，所有测试数据将清空。"
  fi

  if [ "$auto_confirm" = false ]; then
    echo ""
    read -r -p "确认操作? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "已取消。"
      exit 0
    fi
  fi

  for c in "${TEST_CONTAINERS[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
      echo "  停止 $c ..."
      docker stop "$c" >/dev/null 2>&1 || true
      if [ "$remove" = true ]; then
        echo "  删除 $c ..."
        docker rm "$c" >/dev/null 2>&1 || true
      fi
    fi
  done

  if [ "$remove_volumes" = true ]; then
    echo ""
    echo "==> 删除数据卷..."
    for vol in compat-testing_oc-2026-4-23-data compat-testing_oc-2026-4-24-data compat-testing_oc-latest-data compat-testing_hermes-prod-mirror-data compat-testing_hermes-latest-data hermes-latest-data; do
      docker volume rm "$vol" >/dev/null 2>&1 || true
    done
  fi

  echo ""
  echo "==> 完成"
}

restart_containers() {
  echo "==> 重启所有测试容器..."
  cd "$COMPOSE_DIR"
  for c in "${TEST_CONTAINERS[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
      echo "  重启 $c ..."
      docker restart "$c" >/dev/null 2>&1 || true
    else
      echo "  $c 不存在，跳过（请用 start-container.sh 启动）"
    fi
  done
  echo "==> 完成"
}

show_logs() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "Usage: bash scripts/manage-test-env.sh logs <container-name>"
    echo "Available: ${TEST_CONTAINERS[*]}"
    exit 1
  fi
  docker logs -f --tail 50 "$name"
}

case "$cmd" in
  status|s)
    show_status
    ;;
  stop|down)
    shift
    stop_containers "$@"
    ;;
  restart|reboot)
    restart_containers
    ;;
  logs|log)
    shift
    show_logs "$@"
    ;;
  *)
    echo "Usage: bash scripts/manage-test-env.sh {status|stop [-r|-v] [-y]|restart|logs <container>}"
    exit 1
    ;;
esac
