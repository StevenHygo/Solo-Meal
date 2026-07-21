# Changelog

本项目采用 [Semantic Versioning](https://semver.org/)；Beta 版本在合并到 `main` 前通过功能分支验证。

## [Unreleased]

### Added

- PostgreSQL/PostGIS 初始 schema、成对回滚迁移和幂等 v0 种子。
- 配置、城市、地点建议、餐厅搜索、详情和健康检查只读 API。
- 显式 `postgres`/`fixture` 仓储、WGS84/GCJ-02 规范化、结构化营业时间和确定性排序。
- API 契约、坐标、营业时间、迁移、目录和 v0 字段兼容测试。
- Web 静态/API 仓储适配、数据源状态、同查询缓存和静态快照降级。
- 默认关闭的服务端纠错 API，以及同一事务内的复核任务、审计记录和 Outbox 事件。
- 受令牌保护的复核队列 API、任务认领/释放/结束规则和证据过期扫描。
- 不持久化运营令牌的最小运营台，支持队列筛选、处理说明和显式证据扫描。
- 环境开关、鉴权、并发幂等回放、任务抢占和 PostgreSQL 事务回滚测试。

### Changed

- Web 搜索、详情、收藏、复制地址和地图导航统一通过仓储或仓储缓存读取。
- 浏览器原生定位保持 WGS84 类型，地点建议保留明确坐标类型。
- 根工作区改用 pnpm 11，统一执行 Web、小程序和 API 校验。
- API 模式纠错进入服务端队列；发送失败时保留为本机待同步记录，且只允许用户显式重试。

### Compatibility

- API UUID 通过 `legacy_id` 映射回 `r001`-`r006`，既有收藏 ID 与 `localStorage` key 不变。
- API 仍需通过 `dataSource=api` 显式启用，默认继续使用 v1 版本化静态快照。

### Planned

- 真实 POI 候选导入、去重、字段核验、审核发布和批量失败重试。
- PostGIS 运行演练、备份恢复、生产 MFA/RBAC 和上海新增覆盖区域。

## [1.0.0-beta.1] - 2026-07-21

### Added

- 16 类配置驱动的食物品类和统一 SVG 图标 registry。
- 上海、北京、深圳、杭州的区域级覆盖状态原型。
- 位置搜索面板以及 `live`、`beta`、`upcoming`、`paused`、`unsupported` 降级状态。
- 品类、图标、覆盖配置和静态餐厅 fixture 的自动一致性检查。

### Changed

- 现有 6 家 v0 餐厅映射到稳定的 v1 品类 code 和上海试点覆盖区。
- 页面版本标识升级为 Web v1 Beta，布局、筛选、详情、收藏和纠错流程保持连续。

### Compatibility

- 保留 v0 餐厅 ID 和 `localStorage` key，已有本机收藏与偏好无需迁移。
