# 一人食 Web v1 Beta

一个帮助独自用餐者找到合适餐厅的 Web Beta。v1 在保留 v0 找店体验的基础上，加入配置驱动的食物品类、区域级覆盖状态、PostgreSQL/PostGIS 数据模型、搜索 API 和默认关闭的纠错复核闭环。前端默认仍使用版本化静态快照，可继续部署到 GitHub Pages；读写 API 均通过显式功能开关联调。

## 网页功能

- 位置授权失败后的静安寺试点数据降级；
- 现在吃、快速解决、安静坐坐、预算友好场景；
- 关键词、预算、品类、营业状态、用餐时间和距离筛选；
- 16 类食物图标和稳定品类 code；
- 上海试点区域搜索，以及北京、深圳等城市的明确开放状态；
- 餐厅列表与不依赖高德 API 的可拖动真实地图；
- 单人适合度、可信度、来源和核验时间；
- 餐厅详情、复制地址及高德地图导航；
- 浏览器本机私有收藏；
- 静态模式本机纠错，以及 API 模式的服务端复核队列和显式失败重试；
- 静态快照、API 实时查询、同查询缓存和故障降级状态；
- 受令牌保护的最小运营台，可处理复核任务、管理城市/覆盖区域与排序配置、查看证据到期和审计投递队列、人工重试失败事件并导出固定字段 CSV；
- 获授权 POI 的幂等批次导入、重复建议、人工分店决策和覆盖质量门槛报告；
- 新分店规范化草稿、核心单人证据、双人审核、发布和撤回工作流；
- 桌面和移动端响应式布局。

## 本地运行

静态页面必须通过 HTTP 访问，不能直接双击 `index.html`。任选一种方式：

```bash
python3 -m http.server 4173 -d web
```

然后访问 [http://localhost:4173](http://localhost:4173)。

### 联调 API

需要 Node.js 20+ 与 pnpm 11：

```bash
pnpm install
API_DATA_SOURCE=fixture pnpm api:dev
```

fixture API 默认监听 `http://127.0.0.1:8787`。保持静态服务器同时运行，然后访问：

```text
http://127.0.0.1:4173/?dataSource=api
```

`dataSource=api` 只用于显式联调。API 不可用时，前端优先保留同一查询的上次成功结果；没有匹配缓存时回退到随版本发布的静态快照。不会把上一城市的缓存用于当前区域。

反馈写 API 默认关闭。仅在本地验证复核闭环时显式启用，并配置至少 32 个字符的运营令牌：

```bash
API_DATA_SOURCE=fixture \
FEEDBACK_API_ENABLED=true \
ADMIN_API_TOKEN=local-stage-c-admin-token-change-me-2026 \
pnpm api:dev
```

访问 [http://127.0.0.1:4173/ops/](http://127.0.0.1:4173/ops/)，填写 API 地址、运营人员 ID 和同一令牌。运营台不会把令牌写入 `localStorage` 或 `sessionStorage`，非本机 API 地址必须使用 HTTPS。生产部署还必须使用独立认证、MFA、RBAC 和密钥轮换；当前共享令牌只用于受控 Beta 或本地联调。

城市总开关暂停时只覆盖各区域的公开有效状态，不会改写区域原配置；恢复城市后各区域回到原状态。区域提升到 `beta` 或 `live` 前会执行对应的版本化质量门槛。审计投递工作区可按未来天数、覆盖区域和核验属性查询尚未过期但即将到期的候选/已发布证据。

排序权重由服务端活动配置控制。运营台可创建五项权重合计为 1 的版本化草稿，并发布新版本或回滚已退休版本；配置切换、审计和 Outbox 在同一事务提交。搜索、详情和配置接口返回活动 `ranking_version`，配置切换后旧分页游标会返回 `INVALID_CURSOR`，避免跨版本续页。

POI 导入只接受附带授权依据的标准化 JSON，并停留在候选队列；确认“新分店”也不会直接进入搜索。运营人员需录入规范字段和有效证据，提交审核后由另一操作人发布；撤回会立即退出公开搜索。文件格式、状态机和 `coverage-beta-v1` / `coverage-live-v1` 门槛见 [Stage C POI 运维约定](./docs/stage-c-poi-operations.md)。

公开网页、商户自有页面或其他已授权来源整理出的试点候选，可以先转成标准 POI Import payload。默认只打印 payload；带本地 API 地址、运营令牌和操作人 ID 时会直接写入候选库，不会发布到用户搜索：

```bash
node scripts/prepare-public-poi-import.mjs docs/examples/public-source-poi-jingan.sample.json
node scripts/prepare-public-poi-import.mjs docs/examples/public-source-poi-jingan.sample.json \
  --api-url http://127.0.0.1:8787 \
  --token local-stage-c-admin-token-change-me-2026 \
  --operator-id operator.demo
```

反馈创建、复核任务、审计记录和 Outbox 事件在一个数据库事务内提交。相同幂等键只创建一份记录；失败反馈保存在浏览器本机，只有用户点击设置中的同步按钮才会重试，不会后台自动发送。

Outbox 由独立 one-shot Worker 消费，不随 API 进程自动启动。配置 `.env` 中的 `OUTBOX_WEBHOOK_URL` 后，由调度器按需执行：

```bash
pnpm outbox:run
```

Worker 使用数据库租约和 `FOR UPDATE SKIP LOCKED` 防止多实例重复领取；投递失败按指数退避，达到 `OUTBOX_MAX_ATTEMPTS` 后进入失败队列。运营台只能把失败事件重新置为待投递，并会写一条审计记录；人工重试本身不产生新 Outbox，避免递归。生产 Webhook 必须使用 HTTPS，令牌应与运营 API Token 分离。

### 使用 PostgreSQL/PostGIS

```bash
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm api:dev
```

生产和默认 API 配置使用 `postgres`；`fixture` 必须显式选择，不能作为生产数据源静默启用。

## 校验

安装依赖后运行全量校验：

```bash
pnpm validate
```

校验覆盖 Web 静态资源和双数据源契约、小程序回归、TypeScript 类型、环境开关、API schema、鉴权和幂等契约、任务转换、坐标转换、营业时间、迁移回滚、排序配置发布/回滚与跨版本分页、Outbox 租约/退避/人工重试，以及浏览器、服务端品类和覆盖配置一致性。

## 部署到 GitHub Pages

仓库内已包含 [`.github/workflows/pages.yml`](./.github/workflows/pages.yml)。推送到 `main` 后，工作流会把 `web/` 目录发布到 GitHub Pages。

1. 在 GitHub 创建空仓库，例如 `solo-meal`。
2. 在本目录初始化并推送：

```bash
git init
git add .
git commit -m "feat: add solo meal web"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/solo-meal.git
git push -u origin main
```

3. 打开 GitHub 仓库的 **Settings > Pages**，将 **Source** 设为 **GitHub Actions**。
4. 工作流成功后访问 `https://<YOUR_USER>.github.io/solo-meal/`。

所有资源使用相对路径，因此可以部署在 GitHub Pages 的仓库子路径下。

## 数据与隐私

- 静态降级餐厅位于 [`web/data.js`](./web/data.js)；fixture API 使用同一批兼容数据，不会请求第三方评价内容。
- 收藏和预算保存在浏览器 `localStorage` 中。静态模式纠错仅保存在本机；API 模式下，用户点击提交或同步后会把餐厅 ID、问题类型和备注发送到配置的“一人食”API。
- API 发送失败的纠错标为本机待同步记录，不会自动重试；清除本机数据会同时删除这些本地记录。已被服务端接收的记录由服务端数据保留策略管理。
- 浏览器定位只在用户主动点击后申请；API 模式会把本次坐标和坐标类型发送到配置的“一人食”API，但前端不保存精确坐标或轨迹。
- 列表地图使用 OpenStreetMap 瓦片展示真实可拖动底图，不接入高德 JS/API；生产流量应使用符合条款的瓦片服务或自建瓦片。
- “地图导航”会在新窗口打开高德 URI 页面；这是用户主动触发的外部跳转。

## 项目结构

```text
web/
  index.html              # 网页结构和无障碍语义
  styles.css              # 响应式视觉系统
  app.js                  # 搜索、筛选、收藏、纠错和状态管理
  config.js               # v1 品类、城市和覆盖区域配置
  data.js                 # 带 v1 code 的 v0 兼容 fixture
  services/               # 静态/API 仓储适配和 HTTP 客户端
  ops/                    # 纠错、POI、发布、排序、审计与投递运营台
  assets/cuisine/         # 16 个 SVG 品类图标
  .nojekyll               # GitHub Pages 静态发布
server/
  migrations/             # PostgreSQL/PostGIS 前进与回滚迁移
  src/                    # 模块化 API、仓储、Outbox Worker、排序、营业和坐标逻辑
  test/                   # API、迁移、坐标、营业与兼容测试
compose.yaml              # 本地 PostGIS 16 开发服务
.github/workflows/
  pages.yml               # GitHub Pages 自动部署
docs/
  competitive-research.md
  miniprogram-design.md
  web-v1-update-design.md  # Web v1 图标、多城市与数据库升级设计
  stage-c-poi-operations.md # POI 候选、去重和覆盖门槛运维约定
miniprogram/               # 暂停维护的原生小程序原型
scripts/
  prepare-public-poi-import.mjs # 公开/授权来源候选转 POI 导入 payload
  validate-web.mjs
```

## 版本管理

- 当前开发版本：`1.0.0-beta.1`，遵循 Semantic Versioning；
- v1 工作在 `codex/web-v1` 功能分支，验证后再合并到 `main`；
- 发布内容记录在 [`CHANGELOG.md`](./CHANGELOG.md)；
- v0 餐厅 ID 和 `localStorage` key 保持不变，已有本机收藏和偏好兼容。

## v1 路线

- [Web v1 更新设计](./docs/web-v1-update-design.md)：食物类别图标、多城市覆盖、数据库/API、数据运营和迁移计划。

## 当前边界

当前 `1.0.0-beta.1` 已完成阶段 A/B，并完成阶段 C 的服务端纠错、复核任务、审计浏览、可靠 Outbox Worker、失败重试、固定字段导出、证据过期扫描与预警、城市/区域开关、排序配置发布/回滚、Provider-neutral POI 候选导入/去重、规范餐厅草稿、双人审核、发布/撤回和版本化覆盖门槛报告；fixture 模式、故障降级和浏览器闭环已验证。由于本机没有 Docker/`psql`，真实 PostGIS 的迁移、种子、空间索引与回滚执行仍需在可用环境演练。阶段 C 尚未接入获授权的真实 Provider 数据，也没有任何新增区域达到 beta 门槛；备份恢复、按请求精确搜索回放和生产 MFA/RBAC 仍未完成。达到这些门槛并完成隐私、地图条款和内容授权评审前，不应扩大公开覆盖或把 API 设为默认数据源。
