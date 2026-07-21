# Changelog

本项目采用 [Semantic Versioning](https://semver.org/)；Beta 版本在合并到 `main` 前通过功能分支验证。

## [Unreleased]

### Planned

- PostgreSQL/PostGIS 数据库、只读 API 与静态数据降级。
- 服务端纠错队列和最小运营后台。

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
