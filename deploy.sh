#!/bin/bash
# 一键部署导航站（Go 前后端版，首次安装用）
# 用法：在机子上（root）运行：bash deploy.sh
#      脚本会自动完成：装 Docker / curl / git（没有才装）、拉代码、
#      编译 Go 镜像、启动容器、检查。管理员账号密码用环境变量设置：
#        NAV_ADMIN_USER=admin NAV_ADMIN_PASSWORD=你的密码 bash deploy.sh
#      不设就是默认 admin / change-me，部署完请马上改掉。
#      注意：这里没有写任何 IP、密码、Token，IP 是运行时自动查出来的。
set -e

cd "$(dirname "$0")"

# ---- 必须是 root（没有 root 就用 sudo，没有 sudo 就报错退出）----
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "错误：请用 root 运行，或先装 sudo。"
    exit 1
  fi
else
  SUDO=""
fi

# ---- 自动安装依赖：Docker / curl / git（已装好就跳过）----
NEED_INSTALL=""
command -v docker >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL docker.io"
command -v curl >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL curl"
command -v git >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL git"
if [ -n "$NEED_INSTALL" ]; then
  echo "正在安装：$NEED_INSTALL ..."
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update
  # shellcheck disable=SC2086
  $SUDO apt-get install -y $NEED_INSTALL
fi

# Docker 服务必须起来
if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl enable docker >/dev/null 2>&1 || true
  $SUDO systemctl start docker >/dev/null 2>&1 || true
fi
if ! docker info >/dev/null 2>&1; then
  echo "错误：Docker 没起来，请检查 docker 服务。"
  exit 1
fi

# ---- 准备代码（优先用同文件夹里的；没有就从 GitHub 拉）----
SRC_DIR="/home/docker/nav-site-src"
REPO="https://github.com/foxlane-ctrl/nav"
if [ ! -f go.mod ] || [ ! -f main.go ]; then
  echo "同文件夹里没有 Go 代码，改从 GitHub 拉取：$REPO"
  if [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" pull --ff-only || { echo "错误：GitHub 拉取失败，请检查网络。"; exit 1; }
  else
    rm -rf "$SRC_DIR"
    git clone "$REPO" "$SRC_DIR" || { echo "错误：GitHub 拉取失败，请检查网络。"; exit 1; }
  fi
  cd "$SRC_DIR"
fi

# ---- 编译并启动（幂等：重复跑也没事）----
ADMIN_USER="${NAV_ADMIN_USER:-admin}"
ADMIN_PASS="${NAV_ADMIN_PASSWORD:-change-me}"
echo "正在构建 Go 镜像（第一次要下载基础镜像，稍等）..."
docker build -t navsite:latest .

docker rm -f nav-site >/dev/null 2>&1 || true

docker run -d --name nav-site --restart always \
  -p 8080:8080 \
  -e NAV_ADMIN_USER="$ADMIN_USER" \
  -e NAV_ADMIN_PASSWORD="$ADMIN_PASS" \
  -v navsite-data:/app/data \
  navsite:latest

sleep 3

# ---- 检查是否真的跑起来了 ----
if ! curl -sf -o /dev/null http://127.0.0.1:8080/healthz; then
  echo "启动失败，看一下日志："
  docker logs nav-site --tail 30
  exit 1
fi
COUNT=$(curl -s http://127.0.0.1:8080/api/bookmarks | grep -o '"categoryId"' | wc -l)
echo "API 正常，当前链接数：$COUNT"

IP=$(curl -s ifconfig.me || echo "你的服务器IP")
echo ""
echo "部署成功！"
echo "导航站地址：http://$IP:8080"
echo "管理员账号：$ADMIN_USER（默认密码 change-me 请马上改掉）"
echo "以后更新：跑一次 bash update.sh 就行，不用再跑这个。"
