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

# ---- 数据升级：卷里如果是初始数据，就换成 Sean's Nav 新版 112 个链接----
# 满足以下任一条件才换：(a) 21 条链接的旧初始数据（21 条且有 XiaoWork Nav）；
# (b) 111 条链接但还带推广参数的旧版（111 条且含 aff=/affId/aff_code/ref_code/invite=）；
# (c) 111 条链接的旧版（已去推广参数，但还带朋友的探针 komari.xiaoworks.com）；
# (d) 110 条链接但还带朋友探针的旧版（同上，中间版本）。
# 新版是 112 条（Sean's Nav：删了朋友的 2 条探针和博客，加了自己的 komari.greystack.dev，
# 再加了 3 条自己的 VPS：绿云 GreenCloud、V.PS、RFC）。
# (e) 110 条的 Sean's Nav 版（有自己的探针，但还没有 3 条新 VPS）也要换成 112 条。
# (f) 113 条的 Sean's Nav 版（还有朋友的博客 blog.xiaoworks.com）也要换成 112 条。
# (g) 112 条的 Sean's Nav 版（RFC 链接还是错的官网首页 https://rfchost.com/）也要换成新版（RFC 改成 Sean 给的产品页）。
# 自己加过/改过链接的数据（条数对不上、也没有上述标记）绝不动。
if [ -f data/data.json ] && docker volume inspect navsite-data >/dev/null 2>&1; then
  OLD_COUNT=$(docker run --rm -v navsite-data:/data alpine sh -c 'grep -c "categoryId" /data/data.json 2>/dev/null || echo 0')
  if [ "$OLD_COUNT" = "21" ] && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "XiaoWork Nav" /data/data.json 2>/dev/null'; then
    echo "检测到旧版初始数据（21 个链接），升级到 Sean's Nav 新版（112 个链接）…"
    docker run --rm -v navsite-data:/data -v "$PWD/data:/seed:ro" alpine cp /seed/data.json /data/data.json
  elif [ "$OLD_COUNT" = "111" ] && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q -E "aff=|affId|aff_code|ref_code|invite=" /data/data.json 2>/dev/null'; then
    echo "检测到旧版 111 个链接数据（还带推广参数），升级到 Sean's Nav 新版（112 个链接）…"
    docker run --rm -v navsite-data:/data -v "$PWD/data:/seed:ro" alpine cp /seed/data.json /data/data.json
  elif [ "$OLD_COUNT" = "111" ] && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "komari.xiaoworks.com" /data/data.json 2>/dev/null'; then
    echo "检测到旧版 111 个链接数据（还带朋友的探针），升级到 Sean's Nav 新版（112 个链接）…"
    docker run --rm -v navsite-data:/data -v "$PWD/data:/seed:ro" alpine cp /seed/data.json /data/data.json
  elif [ "$OLD_COUNT" = "110" ] && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "komari.xiaoworks.com" /data/data.json 2>/dev/null'; then
    echo "检测到 110 个链接数据（还带朋友的探针），升级到 Sean's Nav 新版（112 个链接）…"
    docker run --rm -v navsite-data:/data -v "$PWD/data:/seed:ro" alpine cp /seed/data.json /data/data.json
  elif [ "$OLD_COUNT" = "110" ] && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "komari.greystack.dev" /data/data.json 2>/dev/null' && ! docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "greencloudvps.com" /data/data.json 2>/dev/null'; then
    echo "检测到 110 个链接数据（Sean's Nav 旧版，还没有 3 条新 VPS），升级到新版（112 个链接）…"
    docker run --rm -v navsite-data:/data -v "$PWD/data:/seed:ro" alpine cp /seed/data.json /data/data.json
  elif [ "$OLD_COUNT" = "113" ] && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "komari.greystack.dev" /data/data.json 2>/dev/null' && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "blog.xiaoworks.com" /data/data.json 2>/dev/null'; then
    echo "检测到 113 个链接数据（Sean's Nav 旧版，还带朋友的博客），升级到新版（112 个链接）…"
    docker run --rm -v navsite-data:/data -v "$PWD/data:/seed:ro" alpine cp /seed/data.json /data/data.json
  elif [ "$OLD_COUNT" = "112" ] && docker run --rm -v navsite-data:/data alpine sh -c 'grep -q "://rfchost.com/" /data/data.json 2>/dev/null'; then
    echo "检测到 112 个链接数据（Sean's Nav 旧版，RFC 链接还是错的官网首页），升级到新版（RFC 改成产品页）…"
    docker run --rm -v navsite-data:/data -v "$PWD/data:/seed:ro" alpine cp /seed/data.json /data/data.json
  fi
fi

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
