# 坐标与运行时来源

公开分支只消费已经通过发布审计的运行时 marker 层，不在公开分支重新请求 provider，也不把 provider 候选响应放进公开静态数据。当前计数以 [`data/audit/public-amap-quality.json`](../data/audit/public-amap-quality.json) 和 [`data/audit/public-release-readiness.json`](../data/audit/public-release-readiness.json) 为准。

## 公开坐标边界

- [`data/public/cinemas.json`](../data/public/cinemas.json) 的 901 条记录全部保留，但静态 `location.lat/lng` 为 `null`。
- `/api/public/markers` 只返回被接受的最小 marker 字段；marker 按 `sourceRow`/`id` 关联，不按名称猜配。
- 当前公开审计为 901 accepted、901 markers、0 unresolved/unlocated。
- 未有 marker 的记录仍能在列表和详情中查看；不得用城市中心点或其他推测位置补点。

## 坐标系与位置语义

高德返回的 `providerLat/providerLng` 保持 `providerCrs=GCJ-02`，由 AMap JS API 2.0 直接绘制，不转换为 WGS84。位置字段需区分：

- `identityConfidence`：选中的 POI 是否就是目标影院/影厅。
- `locationConfidence`：坐标是否代表影院、场馆或商场的实际位置。
- `locationGranularity`：`auditorium`、`cinema`、`venue` 或 `mall`。
- `positionType`：`cinema-poi`、`venue-poi` 或 `mall-fallback`。

场所级或商场级坐标只能说明物理位置，不能宣称为精确影厅身份；公开页面应保留该语义。

## 生产前检查

公开分支不提供 provider cache、完整候选列表或坐标批量下载。上线前需要单独检查高德控制台的域名白名单、账户/商业状态和安全密钥轮换；这些检查不能由本地 `npm test` 代替。来源与运行时限制见 [`DATA-LICENSING.md`](DATA-LICENSING.md)。
