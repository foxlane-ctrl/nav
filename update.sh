#!/bin/bash
# 一键更新导航站（Go 前后端版，以后版本更新用，不用手动配置）
# 用法：在机子上（root）运行：bash update.sh
#      脚本会自动从 GitHub 拉最新代码、重新编译镜像、重启服务、检查。
#      GitHub 地址：https://github.com/foxlane-ctrl/nav
#      管理员密码不会被更新重置（存在 Docker 卷 navsite-data 里的数据和
#      容器环境变量里，更新只换代码）。要改密码：改好环境变量后重跑
#      deploy.sh，或 docker rm 后用新密码重跑 update.sh。
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

SRC_DIR="/home/docker/nav-site-src"
REPO="https://github.com/foxlane-ctrl/nav"

# ---- 自动安装依赖：git / curl / Docker（已装好就跳过）----
NEED_INSTALL=""
command -v git >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL git"
command -v curl >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL curl"
command -v docker >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL docker.io"
if [ -n "$NEED_INSTALL" ]; then
  echo "正在安装：$NEED_INSTALL ..."
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update
  # shellcheck disable=SC2086
  $SUDO apt-get install -y $NEED_INSTALL
fi

if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl enable docker >/dev/null 2>&1 || true
  $SUDO systemctl start docker >/dev/null 2>&1 || true
fi
if ! docker info >/dev/null 2>&1; then
  echo "错误：Docker 没起来，请检查 docker 服务。"
  exit 1
fi

# ---- 从 GitHub 拉最新版（拉不到就报错退出，绝不悄悄保留旧版）----
echo "正在从 GitHub 拉取最新版：$REPO"
if [ -d "$SRC_DIR/.git" ]; then
  if ! git -C "$SRC_DIR" pull --ff-only; then
    echo "错误：GitHub 拉取失败（网络不通或仓库有冲突），旧版没有动，更新没有完成。"
    exit 1
  fi
else
  # 文件夹不是 git 仓库：删掉重拉（这个文件夹只放 GitHub 拉下来的代码）
  rm -rf "$SRC_DIR"
  if ! git clone "$REPO" "$SRC_DIR"; then
    echo "错误：GitHub 拉取失败（网络不通或仓库不存在），更新没有完成。"
    exit 1
  fi
fi

cd "$SRC_DIR"
if [ ! -f go.mod ] || [ ! -f main.go ]; then
  echo "错误：GitHub 仓库里没有 Go 代码（go.mod / main.go），更新没有完成。"
  exit 1
fi

# ---- 重新编译并重启（数据在 Docker 卷 navsite-data 里，不会丢）----
# 保留旧容器的管理员环境变量，更新不重置密码
OLD_ENV=$(docker inspect nav-site --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^NAV_ADMIN_' || true)
ADMIN_USER="admin"
ADMIN_PASS="change-me"
if [ -n "$OLD_ENV" ]; then
  ADMIN_USER=$(echo "$OLD_ENV" | grep '^NAV_ADMIN_USER=' | cut -d= -f2-)
  ADMIN_PASS=$(echo "$OLD_ENV" | grep '^NAV_ADMIN_PASSWORD=' | cut -d= -f2-)
  [ -n "$ADMIN_USER" ] || ADMIN_USER="admin"
  [ -n "$ADMIN_PASS" ] || ADMIN_PASS="change-me"
fi
# 本次运行的环境变量优先
[ -n "$NAV_ADMIN_USER" ] && ADMIN_USER="$NAV_ADMIN_USER"
[ -n "$NAV_ADMIN_PASSWORD" ] && ADMIN_PASS="$NAV_ADMIN_PASSWORD"

echo "正在重新构建镜像..."
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
  echo "更新后启动失败，看一下日志："
  docker logs nav-site --tail 30
  exit 1
fi

IP=$(curl -s ifconfig.me || echo "你的服务器IP")
echo ""
echo "更新成功！"
echo "导航站地址：http://$IP:8080"
