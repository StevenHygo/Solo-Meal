# 一人食 Web v1 Beta

一个帮助独自用餐者找到合适餐厅的 Web Beta。v1 在保留 v0 找店体验的基础上，加入配置驱动的食物品类、区域级覆盖状态、PostgreSQL/PostGIS 数据模型和只读搜索 API。前端默认仍使用版本化静态快照，可继续部署到 GitHub Pages；API 通过显式功能开关联调。

## 网页功能

- 位置授权失败后的静安寺试点数据降级；
- 现在吃、快速解决、安静坐坐、预算友好场景；
- 关键词、预算、品类、营业状态、用餐时间和距离筛选；
- 16 类食物图标和稳定品类 code；
- 上海试点区域搜索，以及北京、深圳等城市的明确开放状态；
- 餐厅列表与响应式示意地图；
- 单人适合度、可信度、来源和核验时间；
- 餐厅详情、复制地址及高德地图导航；
- 浏览器本机私有收藏；
- 受限纠错，数据仅保存在本机；
- 静态快照、API 实时查询、同查询缓存和故障降级状态；
- 桌面和移动端响应式布局。

## 本地运行

静态页面必须通过 HTTP 访问，不能直接双击 `index.html`。任选一种方式：

```bash
python3 -m http.server 4173 -d web
```

然后访问 [http://localhost:4173](http://localhost:4173)。

### 联调只读 API

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

校验覆盖 Web 静态资源和双数据源契约、小程序回归、TypeScript 类型、API schema、稳定错误码、坐标转换、营业时间、迁移回滚、排序/分页，以及浏览器、服务端品类和覆盖配置一致性。

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
- 收藏、预算和纠错保存在浏览器 `localStorage` 中，不会上传。
- 浏览器定位只在用户主动点击后申请；API 模式会把本次坐标和坐标类型发送到配置的“一人食”API，但前端不保存精确坐标或轨迹。
- “地图导航”会在新窗口打开高德 URI 页面；这是唯一由用户主动触发的外部跳转。

## 项目结构

```text
web/
  index.html              # 网页结构和无障碍语义
  styles.css              # 响应式视觉系统
  app.js                  # 搜索、筛选、收藏、纠错和状态管理
  config.js               # v1 品类、城市和覆盖区域配置
  data.js                 # 带 v1 code 的 v0 兼容 fixture
  services/               # 静态/API 仓储适配和 HTTP 客户端
  assets/cuisine/         # 16 个 SVG 品类图标
  .nojekyll               # GitHub Pages 静态发布
server/
  migrations/             # PostgreSQL/PostGIS 前进与回滚迁移
  src/                    # 模块化 API、仓储、排序、营业和坐标逻辑
  test/                   # API、迁移、坐标、营业与兼容测试
compose.yaml              # 本地 PostGIS 16 开发服务
.github/workflows/
  pages.yml               # GitHub Pages 自动部署
docs/
  competitive-research.md
  miniprogram-design.md
  web-v1-update-design.md  # Web v1 图标、多城市与数据库升级设计
miniprogram/               # 暂停维护的原生小程序原型
scripts/
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

当前 `1.0.0-beta.1` 已完成阶段 A，并完成阶段 B 的 schema、迁移、种子、只读 API 与前端双数据源代码；fixture 模式和故障降级已验证。由于本机没有 Docker/`psql`，真实 PostGIS 的迁移、种子、空间索引与回滚执行仍需在可用环境演练。正式扩大使用前还需完成真实 POI 接入、运营核验后台、服务端纠错闭环、备份恢复与合规评审。
