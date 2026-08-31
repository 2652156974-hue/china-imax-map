# 高德私有发布模式

## 结论

本模式不更换已经完成审计的高德 POI 坐标源。它使用：

- 高德 Web 端（JS API）作为底图和交互运行时；
- 高德原始 `providerLat/providerLng`，坐标系固定为 GCJ-02；
- `AMap.MarkerCluster` 聚合点位；
- 服务端安全代理保存 `securityJsCode`；
- gitignored 的 `dist-private/` 保存部署运行包；
- 本机回环地址，或带访问认证和 HTTPS 的私有服务器。

它与根目录的公开 AMap JS API 2.0 页面是两个独立出口。私有高德版不会把内部坐标写入 `data/public/cinemas.json`，也不会让公开构建器误带出高德坐标；公开版只通过独立的 server-side marker layer 在运行时取得当前 accepted 最小点位，数量以发布审计为准。

## Key 类型

现有 `AMAP_API_KEY` 是“Web服务”Key，用于服务端 POI 搜索，不能加载浏览器地图。私有高德页面需要同一高德应用下单独建立：

1. 服务平台为“Web端（JS API）”的 Key；
2. 与该 Key 配套的安全密钥。

运行时变量：

```text
AMAP_JS_API_KEY
AMAP_JS_SECURITY_CODE
PRIVATE_MAP_USERNAME
PRIVATE_MAP_PASSWORD
PRIVATE_AMAP_HOST
PRIVATE_AMAP_PORT
```

真实值只能放在进程环境或部署平台的 secret 管理中。仓库中的 `.env.example` 仅列变量名，不包含值。浏览器必须获得 Web 端 Key 才能请求 JS SDK，因此 Key 会出现在 SDK 请求 URL；应在高德控制台设置域名白名单。安全密钥不下发浏览器，由 `scripts/private-amap-server.mjs` 按高德官方建议通过 `/_AMapService` 代理附加。

## 构建

先使用现有冻结审计生成本地坐标层。该步骤不调用高德 API：

```text
node scripts/build-local-preview.mjs
```

再生成私有高德运行包：

```text
node scripts/build-private-amap-release.mjs
```

生成器要求：

- 输入明确声明 `mode=local-preview` 和 `policy.localOnly=true`；
- 记录数必须为 901；
- 只有 `providerCrs=GCJ-02` 且经纬度合法的记录可成为点位；
- 输出不携带 WGS84 `lat/lng`，避免二次转换或误接非高德底图；
- rawCandidates、provider cache、API key 和安全密钥均不进入运行包。

当前 reviewed 层生成 901 条记录，已定位、待核、未定位三态及 accepted/marker 数量以 `data/audit/private-release-quality.json` 为准。运行包位于 `dist-private/`，已被 `.gitignore` 排除。

## 启动

设置环境变量后运行：

```text
node scripts/private-amap-server.mjs
```

默认只监听 `127.0.0.1:8766`。若绑定非回环地址，服务器会强制要求 `PRIVATE_MAP_USERNAME` 与 `PRIVATE_MAP_PASSWORD`，否则拒绝启动。互联网部署还必须放在 HTTPS 反向代理之后；Basic Auth 不应直接暴露在明文 HTTP 上。

服务器提供：

- 静态私有前端；
- `runtime-config.js`，只向浏览器提供 Web 端 Key 和代理路径；
- `/_AMapService/*` 白名单代理，仅转发到 `restapi.amap.com` 或 `webapi.amap.com/v4/map/styles`；
- `noindex`、`no-store`、CSP、拒绝 iframe 等安全响应头；
- 可选 Basic Auth。

服务器不会重新做 POI 搜索，不消耗现有 POI Web 服务请求预算。高德 JS SDK、底图和样式本身会按高德 JS API 的正常运行方式请求官方服务。

## 前端能力

- 901 条影院都保留在列表和统计中；无坐标记录不画点；
- 高德原生 MarkerCluster，筛选后重建聚合数据；
- 投影系统、Dome、地区、营业状态、12 声道、位置粒度筛选；
- 影院名、曾用名、城市、省份、地区和已有地址的本地搜索；
- Popup 展示投影、声道、银幕、座位、状态、位置粒度、双置信度和 Arvin 来源；
- 场馆/商场坐标明确标注“非精确影厅身份定位”；
- 跟随系统亮/暗主题切换高德官方样式；
- 桌面与移动端共用同一数据和筛选逻辑。

## 发布边界

此模式面向个人私有访问，不是公开坐标数据库。不要把 `dist-private/`、`data/local/` 或 AMap provider cache 提交到公开 Git，也不要把它们作为 GitHub Pages 静态资源发布。需要公网访问时，应使用私有服务器、访问认证、HTTPS、域名白名单和部署平台 secrets。

官方参考：

- [地图 JS API 2.0 准备](https://lbs.amap.com/api/javascript-api-v2/prerequisites)
- [JS API 安全密钥使用](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)
- [MarkerCluster 点聚合](https://lbs.amap.com/api/javascript-api-v2/guide/amap-massmarker/marker-cluster)
