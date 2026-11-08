# Sean's Nav（Go 前后端版）

导航页，仿 XiaoWork Nav（nav.xiaoworks.com）的布局：左侧分类栏、中间大时钟、Google 搜索框、米色大方块。
只有一个主题：锦鲤池塘（黑底、橙色点缀、米色方块、像素大锦鲤），右上角可以切滚动模式 / 标签模式。顶部有一排 AI 快捷入口（Muse、ChatGPT、Claude、Gemini）。
这次是完整的前后端：**Go 后端 + 网页前端**，不用 PHP，不用 Node。

- 后端：Go（标准库，无第三方依赖），提供 JSON API，数据存在本地 `data/data.json`（不用数据库）
- 前端：`web/`，打开页面时从 `/api/bookmarks` 拉分类和链接；图标存在 `web/icons/`（从原站公开接口下载的），加载失败时自动换源站 favicon，再失败只留首字母
- 管理员登录后，可直接在网页上加链接、改链接、删链接、加分类、删分类，不用改代码

GitHub 仓库：https://github.com/foxlane-ctrl/nav
部署后地址：`http://你的服务器IP:8080`

## 里面有什么（113 个链接）

链接清单最初从原站公开接口 `https://nav.xiaoworks.com/api/v1/public/navigation` 拿的，之后按 Sean 的使用习惯重排过：AI 在最前面，Daily、常用、VPS 跟在后面。2026-11-08 的改动：删了朋友的 2 条探针（komari探针、极简探针），加了 Sean 自己的探针（我的探针 → https://komari.greystack.dev，Daily 第一位）：

- AI & 智能（10 个）：ChatGPT、Gemini、Claude、Midjourney、DeepSeek、通义千问、kimi、Manus、Grok、Cursor（顶部 AI 快捷入口另有 Muse → https://muse.ai）
- Daily（18 个）：我的探针、博客、个人主页、NodeSeek、烧饼论坛、cloudflare、ITDOG、优选IP、流量消耗器、大文件下载、tcp调优、节点一键脚本、肥羊订阅转换、订阅转换、各地延迟域名、免费图床、剩余价值计算器、地址生成器
- 常用（7 个）：YouTube、GitHub、telegram、Netflix、Spotify、Bilibili、迪士尼+
- VPS/云服务器（31 个）：datawave、Berohost、绿云 GreenCloud、小秘书 V.PS、RFC、DMIT(大妈)、搬瓦工、vmiss、Vmrack、bitsflow、nosla、Jtti、Akile、ReckNerd、谷歌云、甲骨文云、亚马逊云、ColoCrossing、gomami(狗妈)、Hosthatch、Zouter、Evoxt、华纳云、虫网、面包云、阿里云、腾讯云、华为云、莱卡云、优刻得、HytronVPS（海创）
- SpeedTest（8 个）：speedtest、谷歌测速、Fast、cf测速、LibreSpeed、Measurementlab、IP+测速、speedtest单线程
- IP&DNS（14 个）：IP138、IPinfo、ping0、iping、ippure、Scamalytics、IPLEAK、DNSLEAKTEST、BrowserLeaks、DNSCheck、IP 检测、iplark、IP分流检测、IPsuper
- 邮箱（13 个）：Gmail、Outlook、protonmail、QQ邮箱、88完美邮箱、网易邮箱、Yahoo邮箱、临时edu邮箱、tempmail临时邮箱、临时邮箱、nodeseek邮箱、原邮邮箱、微软邮箱管理
- 域名（11 个）：cloudflare、GoDaddy、Namecheap、Nameslio、Gname、Onamae、porkhub、marketing、IONOS、Name、spaceship
- 其他导航（1 个）：科技lion导航站

注意：原站有几条 VPS / 邮箱链接带了他自己的推广参数（aff=…），2026-11-08 已按 Sean 的要求全部去掉了（共 11 条链接：datawave、DMIT(大妈)、搬瓦工、vmiss、Vmrack、Akile、ReckNerd、ColoCrossing、gomami(狗妈)、Hosthatch、HytronVPS（海创）），点这些链接不再给任何人带推广收益。

## 1. 第一次部署：`bash deploy.sh`（一键部署）

在机子上（root，Termius 连上去）跑：

```bash
bash deploy.sh
```

脚本会自动完成：装 Docker / curl / git（没有才装）、启动 Docker、拉代码（同文件夹没有代码时从 GitHub 拉）、编译 Go 镜像、启动容器（8080 端口，开机自启，数据存在 Docker 卷 `navsite-data` 里）、检查能不能打开，最后打印导航站地址。不用手动配置。

管理员账号密码这样设（不设就是默认 `admin / change-me`）：

```bash
NAV_ADMIN_USER=admin NAV_ADMIN_PASSWORD=你的密码 bash deploy.sh
```

**默认密码 `change-me` 部署后必须马上改掉**，不要一直用默认密码。

## 2. 以后更新：`bash update.sh`（一键更新）

改完代码并传到 GitHub 后，在机子上跑：

```bash
bash update.sh
```

脚本会自动完成：从 GitHub 拉最新代码、重新编译镜像、重启容器、检查能不能打开。数据在 Docker 卷里，更新不会丢；管理员密码也不会被更新重置。

如果 GitHub 拉不到，它会报错退出，不会悄悄保留旧版当更新成功。

## 3. 以后怎么加链接

打开导航站，点右上角「管理员登录」，登录后点「＋ 加链接」，填名字、网址、选分类，确定就行。改链接、删链接、加分类都在网页上点几下完成，改完立刻保存到 `data/data.json`，不用再跑更新脚本。

## API（给想自己接的人）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bookmarks` | 全部的分类和链接（不用登录） |
| GET | `/api/me` | 是否已登录管理员 |
| POST | `/api/login` | 登录，`{"username": "...", "password": "..."}` |
| POST | `/api/logout` | 退出登录 |
| POST | `/api/bookmarks` | 加链接（管理员） |
| PUT | `/api/bookmarks/{id}` | 改链接（管理员） |
| DELETE | `/api/bookmarks/{id}` | 删链接（管理员） |
| POST | `/api/categories` | 加分类（管理员） |
| PUT | `/api/categories/{id}` | 改分类名（管理员） |
| DELETE | `/api/categories/{id}` | 删分类（管理员，分类里有链接时不让删） |
| GET | `/healthz` | 健康检查，返回 `ok` |

## 本地开发

```bash
go run .          # 跑在 http://127.0.0.1:8080
go test ./...     # 跑测试
go vet ./...      # 检查代码
```

数据文件在 `data/data.json`（113 个链接，进 Git；第一次启动如果卷里没有，会用它做初始数据）。

更新时如果卷里还是旧版数据（21 条初始数据、111 条带推广参数版、111 条带朋友探针版、110 条带朋友探针版、110 条 Sean's Nav 旧版），`update.sh` / `deploy.sh` 会自动把它换成 Sean's Nav 新版 113 个；自己加过链接的数据不会被动。

## 链接来源

113 个链接里，109 个网址来自原站公开接口，没有自己编的网址；其余 4 条是 Sean 自己的：我的探针（https://komari.greystack.dev）、绿云 GreenCloud（https://greencloudvps.com/）、小秘书 V.PS（https://v.ps/）、RFC（https://rfchost.com/，官网已核实：地区含日本，套餐命名与他那台 RFC-JP2-CO-Mirco 的 CO 系列一致）。图标能从原站下载的都下载到了 `web/icons/`；只有 NodeSeek 的图标原站返回 403，下不到，页面上会自动用它的源站 favicon 代替，实在没有就只显示首字母。
