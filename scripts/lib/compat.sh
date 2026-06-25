#!/bin/bash
#
# Zettelkasten 兼容性判断公共函数
#
# 用法：在其它脚本中 source 本文件
#   source "$(cd "$(dirname "$0")" && pwd)/../lib/compat.sh"
#
# 设计原则：所有与 OpenClaw / Hermes 版本相关的判断都集中到这里，
# 避免在多个脚本里重复写正则。

set -euo pipefail

# 解析 OpenClaw 版本号，输出 "YYYY.MM.DD" 或空字符串
oc_version() {
  openclaw --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true
}

# 比较两个 YYYY.MM.DD 版本号
# 用法：_version_cmp "2026.6.10" "2026.6.0" -> 1（第一个更大）
_version_cmp() {
  local a="$1"
  local b="$2"
  # 去掉前导零避免 bash 八进制歧义
  a=$(echo "$a" | sed 's/\b0\([0-9]\)/\1/g')
  b=$(echo "$b" | sed 's/\b0\([0-9]\)/\1/g')
  local IFS='.'
  read -ra A <<< "$a"
  read -ra B <<< "$b"
  for i in 0 1 2; do
    local x="${A[$i]:-0}"
    local y="${B[$i]:-0}"
    if [[ "$x" -gt "$y" ]]; then
      echo 1
      return
    elif [[ "$x" -lt "$y" ]]; then
      echo -1
      return
    fi
  done
  echo 0
}

# 判断指定版本是否 >= 目标版本
# 用法：if version_ge "2026.6.10" "2026.6.0"; then ...; fi
version_ge() {
  local current="$1"
  local target="$2"
  if [[ -z "$current" ]]; then
    return 1
  fi
  local cmp
  cmp=$(_version_cmp "$current" "$target")
  [[ "$cmp" -ge 0 ]]
}

# 当前 OpenClaw 是否 >= 指定版本
# 用法：if oc_version_ge "2026.6.0"; then ...; fi
oc_version_ge() {
  local target="$1"
  local current
  current=$(oc_version)
  version_ge "$current" "$target"
}

# 指定 OpenClaw 版本的 tools.alsoAllow 推荐值
tool_policy_for_version() {
  local version="$1"
  if version_ge "$version" "2026.6.0"; then
    echo "group:plugins"
  else
    echo "zettelkasten"
  fi
}

# 当前 OpenClaw 的 tools.alsoAllow 推荐值
oc_tool_policy_value() {
  tool_policy_for_version "$(oc_version)"
}

# 指定 OpenClaw 版本是否支持 agents.defaults.systemPromptOverride
supports_system_prompt_override_for_version() {
  local version="$1"
  ! version_ge "$version" "2026.6.0"
}

# 当前 OpenClaw 是否支持 agents.defaults.systemPromptOverride
oc_supports_system_prompt_override() {
  supports_system_prompt_override_for_version "$(oc_version)"
}

# 验证 alsoAllow 条目是否合法
# 2026.6.x+ 允许 zk_*、插件 ID zettelkasten、group:plugins
# 低版本允许 zk_*、zettelkasten
oc_is_valid_also_allow_entry() {
  local entry="$1"
  if [[ "$entry" == zk_* ]]; then
    return 0
  fi
  if [[ "$entry" == "zettelkasten" ]]; then
    return 0
  fi
  if oc_version_ge "2026.6.0" && [[ "$entry" == "group:plugins" ]]; then
    return 0
  fi
  return 1
}
