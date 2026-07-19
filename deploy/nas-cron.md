# NAS 自动更新轮询配置

NAS 不被外部访问、不装 runner、不接收 webhook。本目录的 `nas-poll-update.sh`
每 5 分钟主动查询 GHCR 上 `latest` 镜像的 manifest digest，发现变化就
`docker compose pull && up -d`，实现被动自动更新。

## 1. 首次部署（一次性）

通过 SSH 登录 NAS，以 root 执行：

```sh
DEPLOY=/volume1/docker/aimediacenter

# 1) 创建数据目录
mkdir -p "${DEPLOY}"/{config,downloads,media/movies,media/tv}

# 2) 拉取部署文件（仓库首次 push 后执行；也可手动从 GitHub 下载）
curl -fsSL https://raw.githubusercontent.com/yylonly/AIMediaCenter/main/docker/docker-compose.prod.yml \
  -o "${DEPLOY}/docker-compose.yml"
curl -fsSL https://raw.githubusercontent.com/yylonly/AIMediaCenter/main/deploy/nas-poll-update.sh \
  -o "${DEPLOY}/nas-poll-update.sh"
chmod +x "${DEPLOY}/nas-poll-update.sh"

# 3) 创建 .env（参考仓库根目录 .env.example，至少改下面几项）
cat > "${DEPLOY}/.env" <<'EOF'
JWT_SECRET=换成一段足够长的随机字符串
SUPERUSER=admin
SUPERUSER_PASSWORD=换成你自己的强密码
TMDB_API_KEY=
QB_URL=http://127.0.0.1:8080
QB_USERNAME=admin
QB_PASSWORD=adminadmin
JELLYFIN_URL=http://127.0.0.1:8096
JELLYFIN_API_KEY=
EOF

# 4) 首次启动
cd "${DEPLOY}" && docker compose pull && docker compose up -d
```

> 等待 GitHub Actions 首次构建推送镜像后再执行 `docker compose pull`，
> 否则会报 image not found。可在仓库 Actions 页面查看构建进度。

## 2. 配置定时轮询

### DSM（群晖）任务计划
控制面板 → 任务计划 → 新增 → 计划任务 → 用户定义的脚本：

- **计划**：每 5 分钟运行一次（设置为每天、每 5 分钟）
- **用户**：`root`
- **运行命令**：
  ```
  bash /volume1/docker/aimediacenter/nas-poll-update.sh
  ```

### 通用 crontab
```cron
*/5 * * * * /volume1/docker/aimediacenter/nas-poll-update.sh >> /volume1/docker/aimediacenter/poll.log 2>&1
```

## 3. 工作机制

```
GitHub push -> Actions 构建并推送到 GHCR
                        ↓
NAS 每 5 分钟 poll GHCR digest ──┐
                                 │
          digest 变化？─是─> docker compose pull && up -d，更新 .last-digest
                        │
                        └─否─> 退出
```

- 镜像为 public，NAS 匿名拉取，无需登录或 token
- `.env` 留在 NAS 本地，不进仓库、不进镜像
- 最多 5 分钟延迟感知到新版本
- ghcr.io 直连慢时可用镜像站：`REGISTRY=ghcr.nju.edu.cn bash nas-poll-update.sh`
  （compose 里的 image 也要改成同一镜像站前缀）

## 3.1 应用内「重建容器」

设置页修改公共根目录（`HOST_MEDIA_ROOT` 等）后点「立即重建容器」，应用会把
目标根目录写入 `config/deploy/restart-request.json`。轮询脚本下次运行时
（最多 5 分钟）把新值写进 `.env` 并 `docker compose up -d`，容器以新挂载重建。

想立即生效可手动跑一次：

```sh
REGISTRY=ghcr.nju.edu.cn bash /volume1/docker/aimediacenter/nas-poll-update.sh
```

分类规则的子目录在公共根目录之下，增改子目录**即时生效**，不需要重建。

## 4. 验证

手动跑一次看是否报错：

```sh
bash /volume1/docker/aimediacenter/nas-poll-update.sh
docker compose -f /volume1/docker/aimediacenter/docker-compose.yml ps
```

浏览器访问 `http://<NAS-IP>:3000`，用 `.env` 里的 `SUPERUSER` / `SUPERUSER_PASSWORD` 登录。

## 5. 回滚

编辑 `/volume1/docker/aimediacenter/docker-compose.yml`，把 image tag 从 `latest`
改为具体的历史版本（Actions 每次会同时推送 `sha-<短SHA>` tag），再执行：

```sh
cd /volume1/docker/aimediacenter
# 临时关闭自动更新，避免被拉回 latest
docker compose pull && docker compose up -d --remove-orphans
```

历史 SHA tag 可在 GHCR 包页面或 GitHub Actions 构建日志里查到。
