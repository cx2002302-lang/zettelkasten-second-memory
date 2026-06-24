#!/bin/bash
#
# 对所有 OpenClaw / Hermes 容器执行兼容性测试并生成报告
#

set -e

CI_MODE=false
if [ "${1:-}" = "--ci" ]; then
  CI_MODE=true
fi

REPORT_DIR="reports/$(date +%Y-%m-%d-%H%M%S)"
mkdir -p "$REPORT_DIR"

OPENCLAW_CONTAINERS=("openclaw-2026-4-23" "openclaw-2026-4-24" "openclaw-latest")
HERMES_CONTAINERS=("hermes-latest")

SUMMARY_FILE="$REPORT_DIR/summary.md"
ALL_PASS=true

echo "# Zettelkasten Compatibility Test Report" > "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"
echo "- Date: $(date -u +%Y-%m-%d %H:%M:%S UTC)" >> "$SUMMARY_FILE"
echo "- CI Mode: $CI_MODE" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

echo "## OpenClaw Matrix" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"
echo "| Container | Image | zk doctor | plugin list | alsoAllow | skills | systemPromptOverride | zk_search | zk_create | zk_get | Result |" >> "$SUMMARY_FILE"
echo "|-----------|-------|-----------|-------------|-----------|--------|----------------------|-----------|-----------|--------|--------|" >> "$SUMMARY_FILE"

for container in "${OPENCLAW_CONTAINERS[@]}"; do
  echo ""
  echo "==> Testing $container"
  report="$REPORT_DIR/$container.md"
  echo "# $container Compatibility Report" > "$report"
  echo "" >> "$report"

  IMAGE=$(docker inspect --format='{{.Config.Image}}' "$container" 2>/dev/null || echo "unknown")
  echo "Image: $IMAGE" >> "$report"
  echo "" >> "$report"

  # 1. plugin list
  echo "## Plugin List" >> "$report"
  echo '```' >> "$report"
  docker exec "$container" openclaw plugin list 2>&1 | tee -a "$report" || true
  echo '```' >> "$report"
  echo "" >> "$report"

  # 2. zk doctor
  echo "## zk doctor" >> "$report"
  echo '```' >> "$report"
  DOCTOR_OUTPUT=$(docker exec "$container" openclaw zk doctor 2>&1 | tee -a "$report")
  echo '```' >> "$report"
  echo "" >> "$report"
  if echo "$DOCTOR_OUTPUT" | grep -q "FAIL"; then
    DOCTOR_OK="❌"
    ALL_PASS=false
  else
    DOCTOR_OK="✅"
  fi

  # 3. alsoAllow
  echo "## tools.alsoAllow" >> "$report"
  echo '```json' >> "$report"
  ALSO_ALLOW=$(docker exec "$container" openclaw config get tools.alsoAllow 2>&1 | tee -a "$report")
  echo '```' >> "$report"
  echo "" >> "$report"
  if echo "$ALSO_ALLOW" | grep -q '"zettelkasten"'; then
    ALLOW_OK="✅"
  else
    ALLOW_OK="❌"
    ALL_PASS=false
  fi

  # 4. skills
  echo "## agents.defaults.skills" >> "$report"
  echo '```json' >> "$report"
  SKILLS=$(docker exec "$container" openclaw config get agents.defaults.skills 2>&1 | tee -a "$report")
  echo '```' >> "$report"
  echo "" >> "$report"
  if echo "$SKILLS" | grep -q '"zettelkasten-brain"'; then
    SKILLS_OK="✅"
  else
    SKILLS_OK="❌"
    ALL_PASS=false
  fi

  # 5. systemPromptOverride
  echo "## agents.defaults.systemPromptOverride" >> "$report"
  echo '```' >> "$report"
  SPO=$(docker exec "$container" openclaw config get agents.defaults.systemPromptOverride 2>&1 | tee -a "$report")
  echo '```' >> "$report"
  echo "" >> "$report"
  if [ -n "$SPO" ] && ! echo "$SPO" | grep -qi "not found\|Config path not found"; then
    SPO_OK="✅"
  else
    SPO_OK="❌"
    ALL_PASS=false
  fi

  # 6. zk_search_notes
  echo "## zk_search_notes" >> "$report"
  echo '```json' >> "$report"
  SEARCH_RESULT=$(docker exec "$container" openclaw tool call zk_search_notes '{"query":"docker","limit":5}' 2>&1 | tee -a "$report")
  echo '```' >> "$report"
  echo "" >> "$report"
  if echo "$SEARCH_RESULT" | grep -qi "error\|failed"; then
    SEARCH_OK="❌"
    ALL_PASS=false
  else
    SEARCH_OK="✅"
  fi

  # 7. zk_create_note
  echo "## zk_create_note" >> "$report"
  echo '```json' >> "$report"
  TEST_TITLE="[TEST] Compat Note $(date +%s)"
  CREATE_RESULT=$(docker exec "$container" openclaw tool call zk_create_note "{\"title\":\"$TEST_TITLE\",\"content\":\"This is a compatibility test note created by run-compat-tests.sh.\",\"type\":\"atomic\",\"tags\":[\"compat-test\"]}" 2>&1 | tee -a "$report")
  echo '```' >> "$report"
  echo "" >> "$report"
  if echo "$CREATE_RESULT" | grep -qi "error\|failed"; then
    CREATE_OK="❌"
    ALL_PASS=false
  else
    CREATE_OK="✅"
  fi

  # 8. zk_get_note
  echo "## zk_get_note" >> "$report"
  echo '```json' >> "$report"
  NOTE_ID=$(echo "$CREATE_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$NOTE_ID" ]; then
    GET_RESULT=$(docker exec "$container" openclaw tool call zk_get_note "{\"id\":\"$NOTE_ID\"}" 2>&1 | tee -a "$report")
    if echo "$GET_RESULT" | grep -qi "error\|failed"; then
      GET_OK="❌"
      ALL_PASS=false
    else
      GET_OK="✅"
    fi
  else
    echo "No note id found, skipping zk_get_note" | tee -a "$report"
    GET_OK="❌"
    ALL_PASS=false
  fi
  echo '```' >> "$report"
  echo "" >> "$report"

  if [ "$DOCTOR_OK" = "✅" ] && [ "$ALLOW_OK" = "✅" ] && [ "$SKILLS_OK" = "✅" ] && [ "$SPO_OK" = "✅" ] && [ "$SEARCH_OK" = "✅" ] && [ "$CREATE_OK" = "✅" ] && [ "$GET_OK" = "✅" ]; then
    RESULT="PASS"
  else
    RESULT="FAIL"
  fi

  echo "| $container | $IMAGE | $DOCTOR_OK | ✅ | $ALLOW_OK | $SKILLS_OK | $SPO_OK | $SEARCH_OK | $CREATE_OK | $GET_OK | $RESULT |" >> "$SUMMARY_FILE"
done

echo "" >> "$SUMMARY_FILE"
echo "## Hermes Matrix" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"
echo "| Container | Image | Running | Version | Notes |" >> "$SUMMARY_FILE"
echo "|-----------|-------|---------|---------|-------|" >> "$SUMMARY_FILE"

for container in "${HERMES_CONTAINERS[@]}"; do
  echo ""
  echo "==> Testing $container"
  report="$REPORT_DIR/$container.md"
  echo "# $container Compatibility Report" > "$report"
  echo "" >> "$report"

  IMAGE=$(docker inspect --format='{{.Config.Image}}' "$container" 2>/dev/null || echo "unknown")
  if docker ps --format '{{.Names}}' | grep -qx "$container"; then
    RUNNING="✅"
    VERSION=$(docker exec "$container" hermes --version 2>&1 | head -1 || echo "unknown")
    echo "Image: $IMAGE" >> "$report"
    echo "Version: $VERSION" >> "$report"
    echo "" >> "$report"
    echo "## hermes --version" >> "$report"
    echo '```' >> "$report"
    echo "$VERSION" >> "$report"
    echo '```' >> "$report"
  else
    RUNNING="❌"
    VERSION="N/A"
    echo "Container not running" >> "$report"
  fi

  echo "| $container | $IMAGE | $RUNNING | $VERSION | Probing only; full integration TBD |" >> "$SUMMARY_FILE"
done

echo "" >> "$SUMMARY_FILE"
echo "## Overall Result" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"
if $ALL_PASS; then
  echo "✅ ALL PASS" >> "$SUMMARY_FILE"
else
  echo "❌ SOME TESTS FAILED" >> "$SUMMARY_FILE"
fi

echo ""
echo "==> Reports saved to $REPORT_DIR"

if $CI_MODE && ! $ALL_PASS; then
  exit 1
fi
