#!/bin/bash
#
# 一键安装 Docker Engine + Docker Compose + uidmap
# 用法：sudo bash environments/compat-testing/scripts/install-docker.sh
#

set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run with sudo"
  echo "Usage: sudo bash $0"
  exit 1
fi

echo "==> Updating package index..."
apt-get update

echo "==> Installing Docker Engine, docker-compose and uidmap..."
# 优先使用 ubuntu 自带源中的 docker-compose（兼容国内镜像源）
apt-get install -y docker.io docker-compose uidmap

echo "==> Enabling and starting Docker service..."
systemctl enable --now docker

echo "==> Adding current user ($SUDO_USER) to docker group..."
if [ -n "$SUDO_USER" ]; then
  usermod -aG docker "$SUDO_USER"
fi

echo "==> Verifying installation..."
docker --version
docker-compose --version

echo ""
echo "==> Docker installed successfully."
echo "Please log out and log back in (or run 'newgrp docker') to use docker without sudo."
echo "Then verify with: docker ps"
echo "Note: this environment uses 'docker-compose' (v1) command."
