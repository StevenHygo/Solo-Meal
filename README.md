# 一人食 v0 网页版

一个不依赖 LLM、社交平台或后端服务的静态网页 v0，用于验证“一个人也舒服的餐厅”搜索与决策体验。页面可以直接部署到 GitHub Pages。

## 网页功能

- 位置授权失败后的静安寺试点数据降级；
- 现在吃、快速解决、安静坐坐、预算友好场景；
- 关键词、预算、品类、营业状态、用餐时间和距离筛选；
- 餐厅列表与响应式示意地图；
- 单人适合度、可信度、来源和核验时间；
- 餐厅详情、复制地址及高德地图导航；
- 浏览器本机私有收藏；
- 受限纠错，数据仅保存在本机；
- 桌面和移动端响应式布局。

## 本地运行

静态页面必须通过 HTTP 访问，不能直接双击 `index.html`。任选一种方式：

```bash
python3 -m http.server 4173 -d web
```

然后访问 [http://localhost:4173](http://localhost:4173)。

## 校验

项目无第三方运行时依赖：

```bash
node scripts/validate-web.mjs
```

校验覆盖静态资源、JavaScript 语法、HTML ID 契约、CSS 结构、功能入口、演示数据，以及网页运行时不包含社交、LLM 或微信依赖。

## 部署到 GitHub Pages

仓库内已包含 [`.github/workflows/pages.yml`](./.github/workflows/pages.yml)。推送到 `main` 后，工作流会把 `web/` 目录发布到 GitHub Pages。

1. 在 GitHub 创建空仓库，例如 `solo-meal`。
2. 在本目录初始化并推送：

```bash
git init
git add .
git commit -m "feat: add solo meal web v0"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/solo-meal.git
git push -u origin main
```

3. 打开 GitHub 仓库的 **Settings > Pages**，将 **Source** 设为 **GitHub Actions**。
4. 工作流成功后访问 `https://<YOUR_USER>.github.io/solo-meal/`。

所有资源使用相对路径，因此可以部署在 GitHub Pages 的仓库子路径下。

## 数据与隐私

- 演示餐厅位于 [`web/data.js`](./web/data.js)，不会请求第三方评价内容。
- 收藏、预算和纠错保存在浏览器 `localStorage` 中，不会上传。
- 浏览器定位只在用户主动点击后申请；v0 不保存精确坐标或轨迹。
- “地图导航”会在新窗口打开高德 URI 页面；这是唯一由用户主动触发的外部跳转。

## 项目结构

```text
web/
  index.html              # 网页结构和无障碍语义
  styles.css              # 响应式视觉系统
  app.js                  # 搜索、筛选、收藏、纠错和状态管理
  data.js                 # 静安寺/南京西路演示数据
  .nojekyll               # GitHub Pages 静态发布
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

## 下一版本

- [Web v1 更新设计](./docs/web-v1-update-design.md)：食物类别图标、多城市覆盖、数据库/API、数据运营和迁移计划。

## 当前边界

网页版 v0 是可部署的产品验证版本，不是生产数据平台。正式扩大使用前仍需接入真实 POI 后端、运营核验后台、服务端限流和审计，并完成网站主体、隐私政策和地图服务条款评审。
