# 地图前端架构

## 双版本出口

项目有两个彼此隔离的 AMap JS API 2.0 出口：

- 根目录 `index.html` + `app.mjs`：公开网站候选版。
- `private-amap/`：私人审核版，由 `scripts/build-private-amap-release.mjs` 生成到 gitignored 的 `dist-private/`。

两版都直接使用 AMap 的 GCJ-02 坐标，不做 WGS84 转换。公开版只通过服务端 marker 接口取得当前 accepted 点；私人版读取私有运行包并保留审核状态、候选证据和补充字段。点位数量由 `data/audit/public-amap-quality.json` 动态决定，不固化为历史基线。

## 公开版数据流

```text
data/derived/cinemas.json
        ↓ scripts/build-public-release.mjs
data/public/cinemas.json       901 条静态事实，无坐标
        ↓ browser fetch
POST /api/public/markers       sourceRow/id 请求，最小 accepted 点响应
        ↓
AMap JS API 2.0 + MarkerCluster
```

`data/local/public-amap-reviewed-geocodes.json` 只在服务器内存中加载，既不由静态目录提供，也不作为批量坐标下载文件。marker 只能按 `sourceRow`/`id` 关联，禁止按影院名称猜配。

公开页面在线加载官方 SDK `https://webapi.amap.com/maps?v=2.0`。浏览器只获得 Web 端 JS Key；安全密钥留在服务器，由同源 `/_AMapService` 代理按官方方案附加。服务端响应不包含完整 provider cache、raw provider response 或 rawCandidates。

## 页面能力

- 901 条全部可搜索、筛选并从列表打开详情；无坐标记录仍可查看银幕和座位。
- 当前 accepted GCJ-02 点显示为 marker；未定位记录保留在列表，不伪造点位。具体 accepted/unlocated 数量以发布审计为准。
- 系统、地区、营业状态、12 声道、位置状态和文本搜索可组合使用。
- MarkerCluster 显示聚合数量，单点打开 popup；无坐标记录打开右侧详情面板。
- 宽度、高度、面积和座位分别展示结构化安全值及源表原文；空白显示 `暂无`，多值、换行、NBSP 或异常显示 `待核` 并保留原文。
- 页面显著展示 `@ArvinTingcn`、原始腾讯文档和 AMap 归属。
- 无 AMap 凭据时页面 fail-closed；构建、接口、静态边界和本地 mock QA 仍可运行。

## 坐标语义

运行时 marker 字段为 `providerLat/providerLng`，`providerCrs=GCJ-02`，直接交给 AMap JS API。前端不读取静态 `location.lat/lng`，不做坐标转换，不创建城市中心点，也不为 null 坐标补点。

独立 OSM/Nominatim 审计层的 2 个 WGS84 点只作备用审计，不能与 AMap runtime layer 混用。

## 私人版差异

私人版由 `private-amap/` 提供更完整的审核视图：已定位、待核、未定位三态数量以 `data/audit/private-release-quality.json` 为准；所有 901 条同样保留列表和银幕/座位详情。私人 server 使用 `dist-private/`、环境变量和可选认证；公开版不读取这些路径。

## 验证

静态与边界验证：

```powershell
npm run build:public
npm run validate:public
node scripts/validate-public-boundary.mjs
node --test scripts/map-frontend.test.mjs scripts/public-amap-server.test.mjs
```

浏览器验收应覆盖桌面与窄屏：公开版的 901 条列表、当前运行时点、无坐标详情、银幕/座位原文和来源标注；私人版的三态筛选与无坐标详情。真实 AMap SDK smoke 需要 `AMAP_JS_API_KEY`（Web 端 JS Key）和 `AMAP_JS_SECURITY_CODE`；缺凭据时仍可执行本地 mock UI 验收，但不能宣称真实 SDK/代理 smoke 已通过。
