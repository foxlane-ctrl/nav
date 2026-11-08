#!/bin/bash
# 一键绑定域名：把 nav.greystack.dev 绑到导航站（自动 HTTPS）
#
# 为什么选 Caddy，不用 nginx + certbot：
# Caddy 一个容器就搞定反代 + 自动申请/续期 Let's Encrypt 证书，
# 不用装 certbot、不用写 cron 续期、不用自己拼 nginx 配置，
# 出错面最小，最适合一键脚本。
#
#
# 到 Cloudflare（greystack.dev 的 DNS 就在 Cloudflare，见下）加一条记录：
# 类型：A 名称：nav 内容：107.175.132.20 TTL：自动（或 300）
# 代理状态：关（灰色云朵，DNS only — 不要开橙色云朵代理）
# 加完等 1~5 分钟，等 nav.greystack.dev 能解析到 107.175.132.20 再跑脚本，
# 否则 Let's Encrypt 校验会失败，脚本会直接报错退出，不会把站搞坏。
#
# 用法：在 VPS 上（root，Termius 连上去）运行：bash bind-domain.sh
# 脚本会：检查 nav-site 容器在跑、检查 DNS 已指向本机、检查 80/443 端口、
# 写 Caddyfile、启动 Caddy 容器（host 网络模式，直接占 80/443）、
# 等证书签发、检查 https://nav.greystack.dev/ 能打开。
# 幂等：重复跑也没事。
# 注意：这里没有写任何密码、Token；域名和 IP 都是公开的导航站地址。
set -e

DOMAIN="nav.greystack.dev"
UPSTREAM="127.0.0.1:8080"
CADDY_DIR="/home/docker/caddy"

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

# ---- 自动安装依赖：Docker / curl（已装好就跳过）----
NEED_INSTALL=""
command -v docker >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL docker.io"
command -v curl >/dev/null 2>&1 || NEED_INSTALL="$NEED_INSTALL curl"
if [ -n "$NEED_INSTALL" ]; then
echo "正在安装：$NEED_INSTALL..."
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

# ---- 1. 导航站容器必须在跑 ----
if ! docker ps --format '{{.Names}}' | grep -qx 'nav-site'; then
echo "错误：nav-site 容器没在跑，请先跑 bash deploy.sh 把站起来，再跑这个脚本。"
exit 1
fi
if ! curl -sf -o /dev/null "http://$UPSTREAM/healthz"; then
echo "错误：导航站本机检查失败（http://$UPSTREAM/healthz 不通），请先修好站再绑域名。"
exit 1
fi
echo "导航站本机正常（$UPSTREAM）。"

# ---- 2. DNS 必须已经指向本机，否则 Let's Encrypt 一定失败 ----
MY_IP=$(curl -s ifconfig.me || echo "")
if [ -z "$MY_IP" ]; then
echo "错误：查不到本机公网 IP（ifconfig.me 不通），请检查网络。"
exit 1
fi
DNS_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -n 1)
if [ "$DNS_IP" != "$MY_IP" ]; then
echo "错误：DNS 还没指过来。"
echo " $DOMAIN 现在解析到：${DNS_IP:-（没有记录，NXDOMAIN）}"
echo " 本机公网 IP 是：$MY_IP"
echo " 请先到 Cloudflare 给 greystack.dev 加 A 记录：名称 nav，内容 $MY_IP，代理关（灰色云朵），"
echo " 等几分钟、确认解析到了再跑 bash bind-domain.sh。"
exit 1
fi
echo "DNS 已指向本机（$DOMAIN -> $DNS_IP）。"

# ---- 3. 80/443 端口必须空着（Caddy 要直接占这两个端口）----
# 注意：这台机子以前跑过一个空白 nginx:alpine 容器（OneNav 时代留下的），
# 如果它还占着 80 端口，脚本会停掉它——它里面没有网站，只是占位。
for PORT in 80 443; do
if $SUDO ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
HOLDER=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E ":$PORT->" | awk '{print $1}' | head -n 1)
if [ "$HOLDER" = "nginx" ]; then
echo "80/443 端口被空白 nginx 容器占着，停掉它（里面没有网站）…"
docker rm -f nginx >/dev/null 2>&1 || true
else
echo "错误：端口 $PORT 已被占用（容器：${HOLDER:-未知}），Caddy 占不了 80/443。"
echo " 请先停掉占着 $PORT 的服务，再跑 bash bind-domain.sh。"
exit 1
fi
fi
done

# ---- 4. 写 Caddyfile 并启动 Caddy ----
# 用 --network host：Caddy 直接用本机的 80/443，反代到 127.0.0.1:8080，
# 不用折腾容器间网络和 host.docker.internal。
mkdir -p "$CADDY_DIR"
cat > "$CADDY_DIR/Caddyfile" <<EOF
$DOMAIN {
reverse_proxy $UPSTREAM
encode gzip
}
EOF

docker rm -f caddy >/dev/null 2>&1 || true
echo "正在启动 Caddy（自动申请 Let's Encrypt 证书，第一次要等一会儿）…"
docker run -d --name caddy --restart always \
--network host \
-v "$CADDY_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
-v caddy-data:/data \
-v caddy-config:/config \
caddy:alpine

# ---- 5. 等证书签发，检查 HTTPS 能打开 ----
echo "等证书签发，最多等 120 秒…"
OK=""
for _ in $(seq 1 24); do
if curl -sf -o /dev/null "https://$DOMAIN/healthz"; then
OK="yes"
break
fi
sleep 5
done
if [ -z "$OK" ]; then
echo "HTTPS 检查失败，看一下 Caddy 日志："
docker logs caddy --tail 40
echo "常见原因：DNS 刚改还没生效、80/443 被墙、或 Let's Encrypt 限流。"
echo "等几分钟再跑一次 bash bind-domain.sh（幂等，不会搞坏东西）。"
exit 1
fi

COUNT=$(curl -s "https://$DOMAIN/api/bookmarks" | grep -o '"categoryId"' | wc -l)
echo ""
echo "绑定成功！"
echo "导航站域名地址：https://$DOMAIN/"
echo "API 正常，当前链接数：$COUNT"
echo "以后更新代码照常跑 bash update.sh 就行，域名和证书不用再管（Caddy 自动续期）。"
