# 地图前端与运行时 marker 契约

## 页面组成

- `index.html`：公开页面结构、筛选器、列表、详情和来源标注。
- `app.mjs`：读取静态事实、请求 marker、筛选记录并驱动 AMap JS API 2.0。
- `styles.css`：桌面与窄屏布局。
- `scripts/public-amap-server.mjs`：同源 marker 接口和安全密钥代理。

## 数据流

```text
data/public/cinemas.json
        ↓ 浏览器读取
POST /api/public/markers  (sourceRow/id)
        ↓ 最小 GCJ-02 marker
AMap JS API 2.0 + MarkerCluster
```

marker 只能按 `sourceRow`/`id` 关联，不能按影院名称猜配。静态页面保留全部 901 条记录；没有坐标的记录仍能搜索和打开详情，不补造位置。

## 页面行为

- 地区、系统、营业状态、12 声道和文本搜索可组合使用。
- marker 使用 AMap MarkerCluster；详情面板展示结构化屏幕/座位字段和必要的来源说明。
- 正常单值显示格式化数字；空白显示 `暂无`；多值或异常显示 `待核`，原文保留在说明区域。
- 页面明确展示 @ArvinTingcn 来源与 AMap 归属。
- 缺少运行配置时页面 fail-closed；静态数据验证、接口 mock 和单元测试仍可运行。

## 安全与验证

浏览器只接收 Web 端 JS Key，服务端安全密钥通过同源 `/_AMapService` 代理使用。server 响应不包含 provider cache、完整候选或凭据。

```powershell
npm test
npm run check
npm run validate:public
```

真实 SDK/代理 smoke 还需要本机运行配置；上述本地检查通过不能宣称已完成生产部署。
