# 🎬 AIMediaCenter

An automated media library manager inspired by [MoviePilot](https://github.com/jxxghp/MoviePilot),
rewritten as a full-stack **Next.js 15** app with **TypeScript + Prisma + SQLite**.

Covers the MoviePilot core pipeline in MVP form:

```
Search → Download → Organize (hardlink) → NFO/Poster → Jellyfin Refresh
                          ↑                                   ↑
                     Subscriptions (auto-refresh via cron) ─────┘
```

## ✨ Features (MVP)

- **认证**：JWT + bcrypt + 可选 OTP，`/api/access-token` 兼容 MoviePilot 语义
- **元数据识别**：从种子/文件名解析 title / year / season / episode / codec / group（20+ 测试用例覆盖）
- **TMDB 集成**：`moviedb-promise`，自动挑选中文标题（`alternative_titles.CN` → `translations.SG`）
- **公开站点聚合搜索**：YTS（JSON API）、Nyaa（HTML）、1337x（HTML + magnet）
- **订阅管理**：TV 逐集追更，movie 单次入库；`state.note` 记录已下集数
- **qBittorrent 对接**：`@ctrl/qbittorrent`，支持 magnet + `.torrent` 两种方式，自动写 `DownloadHistory`
- **文件整理**：Nunjucks 命名模板 + hardlink（跨盘自动回退 copy），带字幕跟随
- **NFO / 海报刮削**：Kodi/Jellyfin 兼容 XML
- **Jellyfin**：全库刷新 + 定时同步已入库条目到 `MediaServerItem`
- **定时任务**：`node-cron` + Next.js `instrumentation` 钩子，进程启动即注册
- **三种部署**：`pnpm dev` / Docker Compose 本地构建 / GHCR 镜像 + NAS 自动更新

## 🧱 技术栈

Next.js 15 (App Router) · TypeScript · Prisma · SQLite · Tailwind · shadcn 风格组件 · jose · bcryptjs · otplib · cheerio · @ctrl/qbittorrent · moviedb-promise · nunjucks · xmlbuilder2 · node-cron · vitest

## 📁 目录结构

```
src/
├─ app/
│  ├─ (auth)/login/            登录
│  ├─ (dash)/                  仪表盘 + 侧边栏
│  │  ├─ dashboard/  概览
│  │  ├─ search/     聚合搜索
│  │  ├─ subscribes/ 订阅
│  │  ├─ downloads/  下载
│  │  ├─ history/    整理历史
│  │  ├─ sites/      站点管理
│  │  └─ settings/   全局设置
│  └─ api/                     REST 接口
├─ core/
│  ├─ meta/         文件名解析器
│  ├─ tmdb/         TMDB 客户端 + NFO 刮削
│  ├─ indexer/      站点适配器 (YTS/Nyaa/1337x) + 聚合
│  ├─ downloader/   qBittorrent 适配器
│  ├─ mediaserver/  Jellyfin 适配器
│  ├─ transfer/     hardlink/copy 引擎 + Nunjucks 命名
│  ├─ chain/        Business flows: search / download / subscribe / transfer
│  └─ auth/         JWT
├─ jobs/            node-cron 调度器
└─ instrumentation.ts  服务端启动钩子
prisma/
├─ schema.prisma
└─ seed.ts          初始超级用户 + 预置公开站点
docker/
├─ Dockerfile
├─ docker-compose.yml        本地构建版
└─ docker-compose.prod.yml  NAS 部署版（拉取 GHCR 镜像）
deploy/
├─ nas-poll-update.sh       NAS 轮询自动更新脚本
└─ nas-cron.md              安装说明
tests/
└─ metaVideo.test.ts   文件名解析器单测
```

## 🚀 本地开发

```bash
# 1. 依赖
pnpm install                    # 或 npm i --legacy-peer-deps

# 2. 环境
cp .env.example .env
# 编辑 .env 填 TMDB_API_KEY 等（也可留空，稍后在 UI 里填）

# 3. 数据库 + 种子
npx prisma db push
npx tsx prisma/seed.ts

# 4. 单测
pnpm test

# 5. 开发服务器
pnpm dev
# → http://localhost:3000
# 默认账号：admin / admin （首次登录后请前往 /settings 修改）
```

## 🐳 Docker 部署

```bash
cd docker
# 拷贝并修改环境变量（尤其 JWT_SECRET / TMDB_API_KEY / QB_URL / JELLYFIN_*）
cp ../.env.example .env
docker compose up -d --build
# → http://localhost:3000
```

挂载卷：
- `./config` - SQLite 数据库
- `./downloads` - 下载目录（需与 qBittorrent 保持一致路径）
- `./media/movies`、`./media/tv` - 媒体库目录（同时需被 Jellyfin 挂载）

## ☁️ 自动部署到 NAS（GitHub Actions + GHCR 轮询）

推送 `main` 分支后，GitHub Actions 自动构建多架构镜像（`linux/amd64` + `linux/arm64`）并推送到 GHCR；
NAS 上的轮询脚本每 5 分钟检查镜像 digest，发现变化就 `docker compose pull && up -d`。

```
push main ──> Actions 构建多架构镜像 ──> 推到 ghcr.io (public)
                                              │
NAS 每 5 分钟 poll GHCR digest ──> 变化则 pull && up -d
```

**特点**：NAS 不被外部访问、不装 runner、不接收 webhook；镜像 public 可匿名拉取；`.env` 只留在 NAS 本地，不进仓库/镜像。

### 前置条件

- NAS 启用 SSH + Container Manager（含 `docker compose` 命令，DSM 7+ 自带）
- 路由器/防火墙无需任何配置（NAS 主动外联 GHCR）
- 机型为 x86-64 或 arm64（ARMv7 老机型不在多架构覆盖范围）

### 首次部署（NAS 上一次性操作）

通过 SSH 登录 NAS，以 root 执行（详见 [`deploy/nas-cron.md`](deploy/nas-cron.md)）：

```sh
DEPLOY=/volume1/docker/aimediacenter
mkdir -p "${DEPLOY}"/{config,downloads,media/movies,media/tv}

# 拉取部署 compose 与轮询脚本
curl -fsSL https://raw.githubusercontent.com/yylonly/AIMediaCenter/main/docker/docker-compose.prod.yml -o "${DEPLOY}/docker-compose.yml"
curl -fsSL https://raw.githubusercontent.com/yylonly/AIMediaCenter/main/deploy/nas-poll-update.sh -o "${DEPLOY}/nas-poll-update.sh"
chmod +x "${DEPLOY}/nas-poll-update.sh"

# 创建 .env（参考根目录 .env.example，至少改 JWT_SECRET / SUPERUSER_PASSWORD / TMDB_API_KEY / QB_* / JELLYFIN_*）
nano "${DEPLOY}/.env"

# 等 Actions 首次构建完成后，首次启动
cd "${DEPLOY}" && docker compose pull && docker compose up -d
```

### 配置自动轮询

**DSM**：控制面板 -> 任务计划 -> 新增 -> 计划任务 -> 用户定义的脚本，每 5 分钟、以 root 运行：
```
bash /volume1/docker/aimediacenter/nas-poll-update.sh
```

**通用 crontab**：
```
*/5 * * * * /volume1/docker/aimediacenter/nas-poll-update.sh >> /volume1/docker/aimediacenter/poll.log 2>&1
```

### 使用 / 回滚

- **更新**：push 到 `main`，Actions 构建完成（~5-10 分钟）后 NAS 最多 5 分钟内自动更新
- **回滚**：编辑 `/volume1/docker/aimediacenter/docker-compose.yml`，把 image tag 从 `latest` 改成历史版本 `sha-<短SHA>`（Actions 每次构建会同时推送），再 `docker compose up -d`。历史 SHA 见 GHCR 包页面或 Actions 构建日志
- **访问**：`http://<NAS-IP>:3000`，用 `.env` 里的 `SUPERUSER` / `SUPERUSER_PASSWORD` 登录
- **日志**：`docker compose logs -f`（应用）/ `cat /volume1/docker/aimediacenter/poll.log`（轮询）

### 安全说明

- `.env` 已被 `.gitignore` 忽略，密钥不进仓库、不进镜像、不经 GitHub
- 镜像 push 使用 Actions 自动注入的 `GITHUB_TOKEN`，无需配置任何 secret
- 镜像与仓库均为 public，NAS 匿名拉取无需登录


## 🧪 冒烟测试路径

1. 打开 `/settings`：填入 TMDB API Key、qBittorrent 地址、Jellyfin URL/Key，保存。
2. 打开 `/search`：输入 `The Matrix`，看到 TMDB 结果 + YTS/Nyaa/1337x 种子。
3. 选择一个 TMDB 结果（点击卡片），再点击某个种子的“下载”按钮。
4. `/downloads` 出现该种子的实时进度。
5. 下载完成后 1 分钟内，`/history` 出现整理记录，Jellyfin 触发刷新。
6. `/subscribes` 添加订阅，等待下一次 `CRON_SUBSCRIBE_SEARCH` 触发自动追更（也可点击“立即搜索”）。

## 📐 命名模板变量

支持以下 Nunjucks 变量：`title`, `originalTitle`, `year`, `season`, `episode`, `episodeEnd`, `part`, `resourcePix`, `resourceType`, `videoEncode`, `audioEncode`, `releaseGroup`, `fileExt`, `tmdbid`, `imdbid`。

内置过滤器：`| pad2`, `| upper`, `| lower`。

默认模板：
```
Movie: {{title}} ({{year}})/{{title}} ({{year}}){{ ' - ' + resourcePix if resourcePix }}{{fileExt}}
TV:    {{title}} ({{year}})/Season {{season}}/{{title}} - S{{season | pad2}}E{{episode | pad2}}{{fileExt}}
```

## ⏰ 定时任务

| 变量 | 默认 cron | 说明 |
|---|---|---|
| `CRON_SUBSCRIBE_SEARCH` | `0 */8 * * *` | 全量搜索订阅并推送下载 |
| `CRON_TRANSFER_POLL` | `* * * * *` | 轮询 qB 完成任务并触发整理 |
| `CRON_MEDIASERVER_SYNC` | `0 3 * * *` | 每日同步 Jellyfin 已入库条目 |

## 🚫 MVP 明确未包含

- ❌ 消息通知（Telegram / 微信 / Bark）
- ❌ 插件系统 / 工作流引擎 / AI Agent / MCP
- ❌ Emby / Plex / Transmission
- ❌ 私有 PT 站点（Cookie / Cloudflare / YAML 定义体系）
- ❌ 豆瓣 / TVDB / Bangumi
- ❌ 仪表盘图表统计

## 📄 License

Learning purposes only, based on MoviePilot (GPL-3.0). Not intended for commercial use.
