#!/bin/bash
# 一键绑定域名：把 nav.greystack.dev 绑到导航站（走已有的 nginx，不用 Caddy）
#
# 为什么不用旧的 bind-domain.sh（Caddy）：
# 这台机子 80/443 端口已经被一个 nginx 容器（nginx:alpine，host 网络模式，
# 跑了 4 个月）占着，它在给探针 komari.greystack.dev 做反代，绝对不能停、
# 不能换。Caddy 再起一个容器抢 80/443 一定失败，旧脚本就是这么 aborted 的。
# 所以新做法：往这个 nginx 里加一个 nav.greystack.dev 的 server 配置，
# 反代到本机 127.0.0.1:8080（nav-site 容器），证书用 acme.sh 或 certbot
# 申请，装到 nginx 的 /etc/nginx/certs/ 里。探针的配置一个字都不动。
#
# DNS 在 Sav（greystack.dev 的注册商就是 Sav，解析也在 Sav 里做）：
# 类型：A 名称：nav 内容：107.175.132.20 代理：关
# 加完等几分钟，等 nav.greystack.dev 能解析到 107.175.132.20 再跑脚本。
#
# 用法：在 VPS 上（root，Termius 连上去）运行：bash bind-domain-nginx.sh
# 脚本会：检查 nav-site 在跑、检查 DNS 已指向本机、检查 nginx 容器在跑、
# 找出 nginx 容器的 conf.d 挂载位置、写 nav 的 HTTP 配置、nginx -t + reload、
# 检查 http://nav.greystack.dev/ 能打开、再试着申请证书（有 acme.sh 或
# certbot 才做，没有就只留 HTTP，不装任何东西、不报错退出）、有证书就
# 加上 443 配置并检查 https://nav.greystack.dev/。
# 幂等：重复跑也没事，不会重复写 server 块，不会动 komari 的配置。
# 注意：这里没有写任何密码、Token；域名和 IP 都是公开的导航站地址。
set -euo pipefail

DOMAIN="nav.greystack.dev"
UPSTREAM="127.0.0.1:8080"
NGINX_CONTAINER="nginx"
CONF_NAME="nav.greystack.dev.conf"
CERT_NAME="nav.greystack.dev_cert.pem"
KEY_NAME="nav.greystack.dev_key.pem"

# ---- 必须是 root ----
if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请用 root 运行这个脚本。"
  exit 1
fi

for CMD in docker curl; do
  if ! command -v "$CMD" >/dev/null 2>&1; then
    echo "错误：没找到 $CMD，请先装好再跑。"
    exit 1
  fi
done
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

# ---- 2. nginx 容器必须在跑（它占着 80/443，绝不能停）----
if ! docker ps --format '{{.Names}}' | grep -qx "$NGINX_CONTAINER"; then
  echo "错误：nginx 容器没在跑，请先检查它（它在给探针 komari.greystack.dev 做反代）。"
  exit 1
fi
echo "nginx 容器在跑（80/443 由它管着，脚本不会停它）。"

# ---- 3. DNS 必须已经指向本机 ----
MY_IP=$(curl -s ifconfig.me || echo "")
if [ -z "$MY_IP" ]; then
  echo "错误：查不到本机公网 IP（ifconfig.me 不通），请检查网络。"
  exit 1
fi
DNS_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -n 1 || true)
if [ -z "$DNS_IP" ] && command -v dig >/dev/null 2>&1; then
  DNS_IP=$(dig +short "$DOMAIN" A | head -n 1 || true)
fi
if [ -z "$DNS_IP" ]; then
  # 最后手段：Google DoH（本机 resolver 有时会返回过期结果，不可信）
  DNS_IP=$(curl -s "https://dns.google/resolve?name=$DOMAIN&type=A" \
    | grep -o '"data":"[0-9.]*"' | head -n 1 | cut -d'"' -f4 || true)
fi
if [ "$DNS_IP" != "$MY_IP" ]; then
  echo "错误：DNS 还没指过来。"
  echo " $DOMAIN 现在解析到：${DNS_IP:-（没有记录，NXDOMAIN）}"
  echo " 本机公网 IP 是：$MY_IP"
  echo " 请先到 Sav 给 greystack.dev 加 A 记录：名称 nav，内容 $MY_IP，代理关，"
  echo " 等几分钟、确认解析到了再跑 bash bind-domain-nginx.sh。"
  exit 1
fi
echo "DNS 已指向本机（$DOMAIN -> $DNS_IP）。"

# ---- 4. 找出 nginx 容器的挂载位置 ----
# docker inspect 输出每行：挂载点=宿主机路径，例如 /etc/nginx/conf.d=/home/docker/nginx/conf.d
MOUNTS=$(docker inspect -f '{{range .Mounts}}{{.Destination}}={{.Source}}{{"\n"}}{{end}}' "$NGINX_CONTAINER")
CONF_SRC=$(echo "$MOUNTS" | awk -F= '/^\/etc\/nginx\/conf\.d=/ {print $2; exit}')
WEBROOT_SRC=$(echo "$MOUNTS" | awk -F= '/^\/var\/www\/letsencrypt=/ {print $2; exit}')
CERTS_SRC=$(echo "$MOUNTS" | awk -F= '/^\/etc\/nginx\/certs=/ {print $2; exit}')

if [ -n "$CONF_SRC" ]; then
  echo "nginx 配置目录挂在宿主机：$CONF_SRC"
else
  echo "注意：nginx 的 /etc/nginx/conf.d 没有挂到宿主机，配置只能写进容器里；"
  echo "容器重建后这个文件会丢，到时再跑一次本脚本即可。"
fi
if [ -n "$WEBROOT_SRC" ]; then
  echo "ACME 验证目录挂在宿主机：$WEBROOT_SRC"
fi

# 写配置的去处：有宿主机挂载就写宿主机，否则用 docker exec 写进容器
write_conf() {
  # $1 = 要写入的完整配置文件内容（通过 stdin 传）
  if [ -n "$CONF_SRC" ]; then
    mkdir -p "$CONF_SRC"
    cat > "$CONF_SRC/$CONF_NAME"
  else
    docker exec -i "$NGINX_CONTAINER" tee "/etc/nginx/conf.d/$CONF_NAME" >/dev/null
  fi
}

# 备份已有的 nav 配置（如果有），出问题时恢复
BACKUP_FILE=""
if [ -n "$CONF_SRC" ] && [ -f "$CONF_SRC/$CONF_NAME" ]; then
  BACKUP_FILE="$CONF_SRC/$CONF_NAME.bak"
  cp "$CONF_SRC/$CONF_NAME" "$BACKUP_FILE"
elif [ -z "$CONF_SRC" ] && docker exec "$NGINX_CONTAINER" test -f "/etc/nginx/conf.d/$CONF_NAME"; then
  docker exec "$NGINX_CONTAINER" cp "/etc/nginx/conf.d/$CONF_NAME" "/etc/nginx/conf.d/$CONF_NAME.bak"
  BACKUP_FILE="(container)/etc/nginx/conf.d/$CONF_NAME.bak"
fi

restore_backup() {
  if [ -n "$CONF_SRC" ]; then
    if [ -f "$CONF_SRC/$CONF_NAME.bak" ]; then
      mv "$CONF_SRC/$CONF_NAME.bak" "$CONF_SRC/$CONF_NAME"
    else
      rm -f "$CONF_SRC/$CONF_NAME"
    fi
  else
    if docker exec "$NGINX_CONTAINER" test -f "/etc/nginx/conf.d/$CONF_NAME.bak"; then
      docker exec "$NGINX_CONTAINER" mv "/etc/nginx/conf.d/$CONF_NAME.bak" "/etc/nginx/conf.d/$CONF_NAME"
    else
      docker exec "$NGINX_CONTAINER" rm -f "/etc/nginx/conf.d/$CONF_NAME"
    fi
  fi
}

# nginx 配置测试 + 重载；失败就恢复备份、退出，不留坏配置
nginx_test_reload() {
  if ! docker exec "$NGINX_CONTAINER" nginx -t; then
    echo "错误：nginx 配置检查没通过，正在恢复之前的配置…"
    restore_backup
    docker exec "$NGINX_CONTAINER" nginx -s reload >/dev/null 2>&1 || true
    echo "已恢复，nginx 还在用旧配置跑（探针不受影响）。"
    exit 1
  fi
  docker exec "$NGINX_CONTAINER" nginx -s reload
}

# ---- 5. 先写 HTTP 版配置（只监听 80，给 ACME 验证留路）----
write_conf <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name nav.greystack.dev;

    location ^~ /.well-known/acme-challenge/ {
        default_type "text/plain";
        root /var/www/letsencrypt;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
echo "已写入 nav 的 nginx 配置（HTTP 版）。"
nginx_test_reload
echo "nginx 配置检查通过，已重载。"

# ---- 6. 检查 HTTP 能打开 ----
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN/" || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  # 直连本机再测一次，排除公网解析问题
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" "http://127.0.0.1/" || echo "000")
fi
if [ "$HTTP_CODE" != "200" ]; then
  echo "错误：http://$DOMAIN/ 返回的不是 200（拿到 $HTTP_CODE），请看 nginx 日志："
  docker exec "$NGINX_CONTAINER" tail -n 30 /var/log/nginx/error.log 2>/dev/null || true
  exit 1
fi
echo "HTTP 已通：http://$DOMAIN/ 返回 200。"

# ---- 7. 试着申请 HTTPS 证书（没有 ACME 工具就跳过，不报错）----
ACME=""
if [ -x "$HOME/.acme.sh/acme.sh" ]; then
  ACME="$HOME/.acme.sh/acme.sh"
elif command -v acme.sh >/dev/null 2>&1; then
  ACME="acme.sh"
fi

CERT_OK=""
TMP_CERT_DIR="/tmp/nav-cert"
if [ -n "$ACME" ]; then
  echo "找到 acme.sh，正在申请证书…"
  if [ -z "$WEBROOT_SRC" ]; then
    echo "注意：没找到 nginx 的 /var/www/letsencrypt 挂载，ACME 验证目录不明，跳过 HTTPS。"
    echo "HTTP 已经能用了；想上 HTTPS 请确认验证目录后再跑一次本脚本。"
  else
    mkdir -p "$TMP_CERT_DIR"
    if "$ACME" --issue -d "$DOMAIN" --webroot "$WEBROOT_SRC" --keylength ec-256 \
      && "$ACME" --install-cert -d "$DOMAIN" --ecc \
        --key-file "$TMP_CERT_DIR/nav.key" \
        --fullchain-file "$TMP_CERT_DIR/nav.crt"; then
      docker cp "$TMP_CERT_DIR/nav.crt" "$NGINX_CONTAINER:/etc/nginx/certs/$CERT_NAME"
      docker cp "$TMP_CERT_DIR/nav.key" "$NGINX_CONTAINER:/etc/nginx/certs/$KEY_NAME"
      CERT_OK="yes"
      echo "证书已装到 nginx 的 /etc/nginx/certs/。"
    else
      echo "证书申请失败（常见原因：DNS 刚改、80 端口被墙、Let's Encrypt 限流）。"
      echo "HTTP 已经能用了，等一会儿再跑一次本脚本补证书就行。"
    fi
  fi
elif command -v certbot >/dev/null 2>&1; then
  echo "找到 certbot，正在申请证书…"
  if [ -z "$WEBROOT_SRC" ]; then
    echo "注意：没找到 nginx 的 /var/www/letsencrypt 挂载，ACME 验证目录不明，跳过 HTTPS。"
    echo "HTTP 已经能用了；想上 HTTPS 请确认验证目录后再跑一次本脚本。"
  else
    if certbot certonly --webroot -w "$WEBROOT_SRC" -d "$DOMAIN" \
        --non-interactive --agree-tos --register-unsafely-without-email; then
      docker cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$NGINX_CONTAINER:/etc/nginx/certs/$CERT_NAME"
      docker cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$NGINX_CONTAINER:/etc/nginx/certs/$KEY_NAME"
      CERT_OK="yes"
      echo "证书已装到 nginx 的 /etc/nginx/certs/。"
    else
      echo "证书申请失败（常见原因：DNS 刚改、80 端口被墙、Let's Encrypt 限流）。"
      echo "HTTP 已经能用了，等一会儿再跑一次本脚本补证书就行。"
    fi
  fi
else
  echo "没找到 acme.sh 或 certbot，不申请证书（脚本不会自动装任何东西）。"
  echo "HTTP 已经能用了；想上 HTTPS 请装好 acme.sh 或 certbot 后再跑一次本脚本。"
fi

if [ -z "$CERT_OK" ]; then
  echo ""
  echo "完成（HTTP）：导航站域名地址：http://$DOMAIN/"
  echo "以后更新代码照常跑 bash update.sh 就行。"
  exit 0
fi

# ---- 8. 有证书了：换成 443 配置 + 80 跳 HTTPS ----
write_conf <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name nav.greystack.dev;

    location ^~ /.well-known/acme-challenge/ {
        default_type "text/plain";
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name nav.greystack.dev;

    ssl_certificate /etc/nginx/certs/nav.greystack.dev_cert.pem;
    ssl_certificate_key /etc/nginx/certs/nav.greystack.dev_key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
echo "已写入 nav 的 nginx 配置（HTTPS 版）。"
nginx_test_reload
echo "nginx 配置检查通过，已重载。"

sleep 2
HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/" || echo "000")
if [ "$HTTPS_CODE" != "200" ]; then
  echo "错误：https://$DOMAIN/ 返回的不是 200（拿到 $HTTPS_CODE），HTTP 还能用，先检查："
  docker exec "$NGINX_CONTAINER" tail -n 30 /var/log/nginx/error.log 2>/dev/null || true
  exit 1
fi

echo ""
echo "绑定成功！"
echo "导航站域名地址：https://$DOMAIN/"
echo "HTTP 会自动跳到 HTTPS：http://$DOMAIN/"
echo "探针不受影响：https://komari.greystack.dev 还是走原来的配置。"
echo "以后更新代码照常跑 bash update.sh 就行，域名不用再管。"
echo "注意：证书要续期——acme.sh 装的会自动续（有 cron），certbot 的请确认有续期定时任务。"
