# Stage C POI 候选与覆盖门槛运维约定

> 状态：`coverage-beta-v1` / `coverage-live-v1`
> 适用版本：Web `1.0.0-beta.1` 的 Unreleased Stage C 变更
> 结论：导入 POI 不等于发布餐厅，门槛报告达标也不会自动切换区域状态。

## 1. 强制边界

- 只导入已获授权、允许保存相应字段的 Provider 数据；每个批次必须记录来源标签和授权依据。
- 不接收或保存任意 Provider 原始响应，只保存去重所需的规范化字段。
- 候选 POI 不进入餐厅搜索。`new_branch` 只表示去重完成，仍需核心字段、单人证据和二次审核。
- 候选建立餐厅草稿后，POI 决策状态被锁定；不能再从候选队列改为匹配已有或驳回，避免孤立草稿。
- 名称、地址和 200 米距离只生成重复建议，不自动建立分店映射。
- `(provider, provider_poi_id)` 是跨批次稳定标识；已关联其他餐厅或覆盖区时必须返回冲突。
- GCJ-02 原值与规范化 WGS84 坐标分别保存，不把 GCJ-02 标为 EPSG:4326。
- 所有人工决策和质量指标变更必须写入审计与 Outbox。

## 2. 标准化导入文件

运营台接受 JSON 数组，或带 `candidates` 数组的对象。单批 1-50 条：

```json
{
  "candidates": [
    {
      "provider_poi_id": "provider-poi-id",
      "name": "候选店名",
      "address": "候选地址",
      "district": "所在片区",
      "location": {
        "lat": 31.2231,
        "lng": 121.4452,
        "coord_type": "gcj02"
      },
      "phone": "021-00000000",
      "raw_category": "Provider 原始分类",
      "observed_at": "2026-07-20T04:00:00.000Z"
    }
  ]
}
```

`phone` 和 `raw_category` 可省略。电话号码仅规范化为数字用于后续分店核验，当前不会返回给用户端。

## 3. 候选状态

| 状态 | 含义 | 可执行决策 |
| --- | --- | --- |
| `pending` | 等待人工去重 | 匹配已有、新分店、驳回 |
| `matched` | 已关联规范餐厅和 Provider ID | 终态 |
| `new_branch` | 未发现重复，等待字段与证据核验 | 未建草稿时可创建草稿、改为匹配已有或驳回；建草稿后只进入发布流程 |
| `rejected` | 非餐厅、越界、重复脏数据等 | 终态 |

精确 Provider ID 已存在时，重复导入可直接回放为 `matched`；其他相似度结果只保存 `suggested_restaurant`。高于 `0.8` 的未处理建议会阻断区域准入。

## 4. API

以下接口都要求 `Authorization: Bearer <ADMIN_API_TOKEN>`；会写入候选、草稿、映射、审计或质量指标的 `POST` / `PUT` / `PATCH` 接口还要求 `X-Operator-ID`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/poi/imports` | 创建带幂等键的授权导入批次 |
| `GET` | `/api/v1/admin/poi/candidates` | 按状态和覆盖区域读取候选 |
| `PATCH` | `/api/v1/admin/poi/candidates/:id` | 人工匹配、新分店或驳回决策 |
| `POST` | `/api/v1/admin/poi/candidates/:id/draft` | 从 `new_branch` 候选创建规范化餐厅草稿 |
| `GET` | `/api/v1/admin/restaurants` | 按草稿、待审核、已发布、已撤回读取发布队列 |
| `GET` | `/api/v1/admin/restaurants/:id` | 读取字段、证据、来源和审核轨迹 |
| `PUT` | `/api/v1/admin/restaurants/:id/draft` | 更新仍处于 `draft` 的字段、营业时间和证据 |
| `POST` | `/api/v1/admin/restaurants/:id/transitions` | 提交审核、退回修改、发布或撤回 |
| `GET` | `/api/v1/admin/coverage/:id/quality` | 读取数据库指标和准入检查 |
| `PATCH` | `/api/v1/admin/coverage/:id/quality` | 记录人工抽样、条款和演练指标 |
| `GET` | `/api/v1/admin/audit-logs` | 按操作人、动作或实体筛选审计记录 |
| `GET` | `/api/v1/admin/outbox-events` | 按状态、主题或聚合 ID 查看投递事件 |
| `POST` | `/api/v1/admin/outbox-events/:id/retry` | 把失败事件人工重新置为待投递 |
| `GET` | `/api/v1/admin/exports/:dataset.csv` | 导出最多 1000 行固定字段数据 |

运营台地址为 `/ops/`。令牌只保存在当前页面内存，不写入浏览器存储；非本机 API 必须使用 HTTPS。

## 5. Outbox 投递与导出

- API 进程不自动消费 Outbox；使用 `pnpm outbox:run` 启动独立 one-shot Worker，并由外部调度器控制频率。
- PostgreSQL 领取使用 `FOR UPDATE SKIP LOCKED`，写入 Worker 租约并增加尝试次数；超时租约可被其他 Worker 回收。
- 失败按指数退避，达到最大次数后进入 `failed`；人工重试只允许 `failed -> pending`，写审计但不再产生 Outbox。
- Webhook 在生产环境只允许 HTTPS，投递 Token 与运营 Token 分离，错误只保存经过截断和换行清洗的信息。
- CSV 只允许 `restaurants`、`poi_candidates`、`curation_tasks`、`audit_logs` 四个数据集，最多 1000 行；审计导出不包含修改前后 JSON，所有字符串按 CSV 公式注入规则转义。

## 6. 餐厅发布状态

```text
new_branch -> draft -> review -> published -> withdrawn
                 ^        |
                 +--------+
```

- 草稿保存规范名称、地址、品类、价格、座位、单人画像、营业时间和可过期证据；草稿不进入公开搜索。
- `submit_review` 和 `publish` 都会重新检查核心字段、已确认的单人接待和未过期候选证据。
- `publish` 必须由提交审核之外的操作人执行；同一操作人会收到 `SECOND_REVIEWER_REQUIRED`。
- 发布事务同时写入 Provider 映射、发布证据、候选匹配、审计和 Outbox；任一步失败即回滚。
- `withdraw` 会立即把餐厅移出公开搜索。发布或撤回不会自动修改覆盖区域的 `upcoming` / `beta` / `live` 状态。

## 7. Beta 准入

`coverage-beta-v1` 所有条件必须同时满足：

| 指标 | 门槛 | 来源 |
| --- | ---: | --- |
| 已发布且完成单人核验的餐厅 | `>= 30` | 数据库 |
| 2 公里测试点能返回至少 5 家的覆盖率 | `>= 60%` | 人工抽样 |
| 90 天内核心字段核验率 | `>= 80%` | 数据库 |
| 核心字段完整率 | `>= 85%` | 数据库 |
| 已发布餐厅 Provider ID 关联率 | `>= 90%` | 数据库 |
| 高置信重复待处理 | `= 0` | 候选队列 |
| 抽样分店错配率 | `<= 2%` | 人工抽样 |
| 抽样到店符合率 | `>= 70%` | 人工抽样 |
| 高优纠错五工作日处理率 | `>= 80%` | 任务队列 |
| 严重数据质量事故连续无发生 | `>= 2 周` | 人工记录 |
| Provider 条款、隐私、PostGIS 迁移回滚演练 | 全部通过 | 人工记录 |

## 8. Live 准入

`coverage-live-v1` 保留 v1 设计的更高门槛：至少 100 家已发布餐厅、2 公里测试点覆盖率不低于 80%、90 天核验率不低于 70%、核心字段完整率不低于 85%、分店错配率不高于 1%、到店符合率不低于 75%、高优纠错五工作日处理率不低于 90%，并连续两周无严重事故。另要求 Provider ID 关联率不低于 95%、无高置信重复待处理，以及三项条款/演练全部通过。

## 9. 当前状态

- 仓库没有已授权的真实地图 Provider 数据或生产凭据。
- 徐家汇、淮海中路等新增区域没有已发布餐厅、抽样记录或 PostGIS 演练证据，必须保持 `upcoming`。
- 静安/黄浦的 6 条 v0 兼容 fixture 只用于回归，不满足 `coverage-beta-v1`，不能作为真实覆盖证明。
- 核心字段/证据录入、双人审核、发布和撤回已在 fixture、PostgreSQL 事务测试及浏览器闭环中实现。
- 审计浏览、批量导出、数据库租约 Worker 和失败重试已实现；真实 Provider Adapter、覆盖区域开关和生产 MFA/RBAC 仍待完成。
- 真实 PostgreSQL/PostGIS 迁移、空间索引、备份恢复和回滚仍需在具备 Docker 或 `psql` 的环境执行。
