# 我的导航站（Go 前后端版）

深色导航页，仿 XiaoWork Nav 的样子：左侧分类栏、中间大时钟、Google 搜索框、大图标方块。
这次是完整的前后端：**Go 后端 + 网页前端**，不用 PHP，不用 Node。

- 后端：Go（标准库，无第三方依赖），提供 JSON API，数据存在本地 `data/data.json`（不用数据库）
- 前端：`web/`，打开页面时从 `/api/bookmarks` 拉分类和链接
- 管理员登录后，可直接在网页上加链接、改链接、删链接、加分类、删分类，不用改代码

GitHub 仓库：https://github.com/foxlane-ctrl/nav
部署后地址：`http://你的服务器IP:8080`

## 里面有什么（21 个链接）

- Daily：NodeSeek、cloudflare、ITDOG、komari探针（4 个）
- SpeedTest：speedtest、Fast、cf测速、LibreSpeed、MeasurementLab（5 个）
- 常用：GitHub、Google（2 个）
- IP&DNS：IP查询（1 个）
- AI & 智能：ChatGPT、Claude、Gemini（3 个）
- VPS/云服务器：V.PS、DMIT、GoMami（3 个）
- 邮箱：Gmail、Outlook（2 个）
- 域名：暂无
- 其他导航：XiaoWork Nav（1 个）

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

数据文件在 `data/data.json`（第一次启动自动生成，里面就是上面 21 个链接；这个文件不进 Git）。

## 没加上的链接（不知道真实网址，没硬编）

朋友截图里这些只看到名字、不知道网址，所以没放进来，知道网址后在网页上用管理员账号加上就行：

- Daily：博客、个人主页、娱乐论坛、优选IP、流量消耗器、大文件下载、tcp测速、节点一键脚本、肥羊订阅转换、订阅转换、各地延迟城市名、免费图片、剩余价钱计算器、地址生成器、极速探针
- SpeedTest：谷歌测速、IP+测速、speedtest单线程
- IP&DNS、域名：截图里有分类和数量，但没看到具体链接名
