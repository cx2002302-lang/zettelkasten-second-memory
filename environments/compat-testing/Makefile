# Zettelkasten 兼容性测试环境 — 一键管理（第 1 层关闭保障）
#
# 常用：
#   make up        构建并启动 4 个测试容器
#   make test      运行兼容性测试并生成报告（reports/<时间戳>/）
#   make logs      跟踪全部日志（make logs S=openclaw-latest 看单个）
#   make ps        查看容器状态
#   make down      停止并删除全部测试容器（保留数据卷）
#   make clean     停止并删除容器 + 数据卷 + 本地构建镜像（完全清理）
#
# 兜底（第 2 层）：bash scripts/cleanup-docker.sh

SHELL := /bin/bash
ROOT  := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

# ---------------------------------------------------------------------------
# Compose 探测：优先项目内置 v2+ standalone，其次 docker compose 插件，
# 最后退回系统 docker-compose（v1，能用但不保证未来兼容）
# ---------------------------------------------------------------------------
ifneq ($(wildcard $(ROOT)/bin/docker-compose),)
COMPOSE := $(ROOT)/bin/docker-compose
else ifneq ($(shell docker compose version >/dev/null 2>&1 && echo yes),)
COMPOSE := docker compose
else
COMPOSE := docker-compose
endif

# 读取 .env 中的版本固定（不覆盖命令行传入）
-include $(ROOT)/.env
OPENCLAW_PROD_VERSION ?= 2026.4.24
HERMES_PROD_TAG       ?= 0.17.0

NETWORK := compat-testing
PROD_OC_VOLUME := compat-testing_oc-$(subst .,-,$(OPENCLAW_PROD_VERSION))-data

.DEFAULT_GOAL := help
.PHONY: help network up down ps logs test seed pin-hermes-prod pull clean

help: ## 显示可用目标
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Compose: $(COMPOSE)"

network: ## 确保 compat-testing 网络存在
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || \
	  { echo "==> 创建网络 $(NETWORK)"; docker network create $(NETWORK); }

up: network pin-hermes-prod ## 构建并启动全部 4 个测试容器
	cd $(ROOT) && $(COMPOSE) --env-file .env up -d --build
	@$(MAKE) -s ps

down: ## 停止并删除全部测试容器（保留数据卷）
	cd $(ROOT) && $(COMPOSE) down --remove-orphans

ps: ## 查看容器状态
	@cd $(ROOT) && $(COMPOSE) ps

logs: ## 跟踪日志（S=<service> 看单个服务）
	cd $(ROOT) && $(COMPOSE) logs -f $(S)

test: ## 运行兼容性测试并生成报告
	cd $(ROOT) && bash scripts/run-compat-tests.sh

seed: ## 为 prod-mirror 数据卷播种预置配置（已存在则跳过）
	@if docker run --rm -v $(PROD_OC_VOLUME):/data busybox sh -c 'test -f /data/openclaw.json' 2>/dev/null; then \
	  echo "==> $(PROD_OC_VOLUME) 已含 openclaw.json，跳过"; \
	else \
	  echo "==> 向 $(PROD_OC_VOLUME) 播种 config/openclaw-container.json"; \
	  docker run --rm -v $(PROD_OC_VOLUME):/data \
	    -v $(ROOT)/config/openclaw-container.json:/tmp/cfg.json:ro \
	    busybox sh -c 'cp /tmp/cfg.json /data/openclaw.json && chown 1000:1000 /data/openclaw.json && chmod 600 /data/openclaw.json'; \
	fi

pin-hermes-prod: ## 将本地已验证的 hermes latest 固化为生产版本 tag
	@if docker image inspect nousresearch/hermes-agent:$(HERMES_PROD_TAG) >/dev/null 2>&1; then \
	  true; \
	elif docker image inspect nousresearch/hermes-agent:latest >/dev/null 2>&1; then \
	  echo "==> 固定 nousresearch/hermes-agent:latest → :$(HERMES_PROD_TAG)"; \
	  docker tag nousresearch/hermes-agent:latest nousresearch/hermes-agent:$(HERMES_PROD_TAG); \
	else \
	  echo "⚠️  本地无 nousresearch/hermes-agent 镜像，请先 docker pull"; \
	fi

pull: ## 刷新 latest 上游镜像（滚动版本跟踪）
	docker pull ghcr.io/openclaw/openclaw:latest
	docker pull nousresearch/hermes-agent:latest

clean: ## 完全清理：容器 + 数据卷 + 本地构建镜像
	cd $(ROOT) && $(COMPOSE) down -v --remove-orphans --rmi local
	@echo "==> 完成。如需强制清理残留（含脚本时代容器）：bash scripts/cleanup-docker.sh --volumes"
