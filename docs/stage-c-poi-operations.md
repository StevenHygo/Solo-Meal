# Stage C POI 候选与覆盖门槛运维约定

> 状态：`coverage-beta-v1` / `coverage-live-v1`
> 适用版本：Web `1.0.0-beta.1` 的 Unreleased Stage C 变更
> 结论：导入 POI 不等于发布餐厅，门槛报告达标也不会自动切换区域状态。

## 1. 强制边界

- 只导入已获授权、允许保存相应字段的 Provider 数据；每个批次必须记录来源标签和授权依据。
- 不接收或保存任意 Provider 原始响应，只保存去重所需的规范化字段。
- 候选 POI 不进入餐厅搜索。`new_branch` 只表示去重完成，仍需核心字段、单人证据和二次审核。
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
| `new_branch` | 未发现重复，等待字段与证据核验 | 可改为匹配已有或驳回 |
| `rejected` | 非餐厅、越界、重复脏数据等 | 终态 |

精确 Provider ID 已存在时，重复导入可直接回放为 `matched`；其他相似度结果只保存 `suggested_restaurant`。高于 `0.8` 的未处理建议会阻断区域准入。

## 4. API

以下接口都要求 `Authorization: Bearer <ADMIN_API_TOKEN>`；会写入候选、映射、审计或质量指标的 `POST` / `PATCH` 接口还要求 `X-Operator-ID`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/poi/imports` | 创建带幂等键的授权导入批次 |
| `GET` | `/api/v1/admin/poi/candidates` | 按状态和覆盖区域读取候选 |
| `PATCH` | `/api/v1/admin/poi/candidates/:id` | 人工匹配、新分店或驳回决策 |
| `GET` | `/api/v1/admin/coverage/:id/quality` | 读取数据库指标和准入检查 |
| `PATCH` | `/api/v1/admin/coverage/:id/quality` | 记录人工抽样、条款和演练指标 |

运营台地址为 `/ops/`。令牌只保存在当前页面内存，不写入浏览器存储；非本机 API 必须使用 HTTPS。

## 5. Beta 准入

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

## 6. Live 准入

`coverage-live-v1` 保留 v1 设计的更高门槛：至少 100 家已发布餐厅、2 公里测试点覆盖率不低于 80%、90 天核验率不低于 70%、核心字段完整率不低于 85%、分店错配率不高于 1%、到店符合率不低于 75%、高优纠错五工作日处理率不低于 90%，并连续两周无严重事故。另要求 Provider ID 关联率不低于 95%、无高置信重复待处理，以及三项条款/演练全部通过。

## 7. 当前状态

- 仓库没有已授权的真实地图 Provider 数据或生产凭据。
- 徐家汇、淮海中路等新增区域没有已发布餐厅、抽样记录或 PostGIS 演练证据，必须保持 `upcoming`。
- 静安/黄浦的 6 条 v0 兼容 fixture 只用于回归，不满足 `coverage-beta-v1`，不能作为真实覆盖证明。
- 真实 Provider Adapter、核心字段/证据录入、二次审核和发布/撤回界面仍待完成。
- 真实 PostgreSQL/PostGIS 迁移、空间索引、备份恢复和回滚仍需在具备 Docker 或 `psql` 的环境执行。
