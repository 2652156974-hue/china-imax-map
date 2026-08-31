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
AMap JS API 2.0 + 自定义行政层级 marker
```

`data/local/public-amap-reviewed-geocodes.json` 只在服务器内存中加载，既不由静态目录提供，也不作为批量坐标下载文件。marker 只能按 `sourceRow`/`id` 关联，禁止按影院名称猜配。

公开页面在线加载官方 SDK `https://webapi.amap.com/maps?v=2.0`。浏览器只获得 Web 端 JS Key；安全密钥留在服务器，由同源 `/_AMapService` 代理按官方方案附加。服务端响应不包含完整 provider cache、raw provider response 或 rawCandidates。

## 行政层级聚合

前端聚合优先使用行政归属，不把纯空间距离作为一级聚类逻辑。当前视图只保留一个主导行政层级：

- `zoom ≤ 5`：省级 marker；
- `5 < zoom ≤ 7`：地级行政区 marker；北京、上海、天津、重庆等直辖市跳过普通地级市，直接进入区县层级；
- `7 < zoom < 9`：县级行政区 / 市辖区 / 县级市 marker；
- `zoom ≥ 9`：逐步解除聚合，优先显示单影院 marker；极密集点只允许在同一县区内进行小范围局部聚合。

在 `zoom=5/7/9` 边界只切换一次，不同时绘制相邻行政层级；`zoom=9` 作为县区 marker 向单影院 marker 过渡的起点。

当前主层级缺少精确行政绑定的少量影院不会被猜入相邻区县，也不会回退成与主层级竞争的上一级数字圆；它们暂以单影院 marker 显示，等待后续离线证据补齐。

筛选和搜索先作用于影院集合，再重新计算行政聚合数量；数字 marker 不得跨省、跨地级市或跨县区合并。县级市在数据层仍属于县级行政单位，UI 直接显示“昆山市”“江阴市”等正式名称。

行政 marker 的显示锚点优先使用行政区 `label point`，其次使用行政区 visual center；两者不可用时，才使用组内影院坐标 medoid。该锚点只决定数字 UI 的视觉位置，不修改任何影院坐标事实。

当前 901 条发布层尚未绑定一套经过本项目审计的行政区官方中心点或 polygon，因此现有真实记录会明确走 medoid fallback；这不是官方中心点声明。聚合核心已支持离线 `label point` / visual center 输入，后续只有在补齐可追溯的本地行政中心数据后才能启用，浏览器不得为此临时查询地图 provider。

行政归属只在本地构建阶段从 provider cache 提取为最小绑定字段。浏览器只接收允许展示的行政字段和运行时 marker，不接收 raw candidates、完整 provider response，也不发起 `DistrictSearch`、`Geocoder` 或 POI 查询来补齐聚合层级。

## 页面能力

- 901 条全部可搜索、筛选并从列表打开详情；无坐标记录仍可查看银幕和座位。
- 当前 accepted GCJ-02 点显示为 marker；未定位记录保留在列表，不伪造点位。具体 accepted/unlocated 数量以发布审计为准。
- 系统、地区、营业状态、12 声道和文本搜索可组合使用；筛选/搜索结果会同步作用于行政聚合计数，位置粒度仍保留在详情层，不作为普通用户主筛选。
- 自定义行政层级 marker 显示省、市、县区名称与影院数量；在空间不足时可仅显示数字，但 marker 仍绑定行政名称；单影院打开 popup，无坐标记录打开右侧详情面板。
- 点击省级 marker 后，地图节点、列表与统计先限定为该省记录，再渲染省内下级节点；点击城市继续收窄，不显示作用域外省份或城市的数据。
- 焦点导航提供全国/省/市面包屑、`← 返回` 和 `Escape` 逐级返回，并恢复进入焦点前的地图视图。
- 宽度、高度、面积和座位分别展示结构化安全值及源表原文；空白显示 `暂无数据`，多值、换行、NBSP 或异常显示 `待核` 并保留原文。
- 用户主动点击“我的位置”后才调用 `AMap.Geolocation`；定位成功进入附近模式，默认先限定城市候选集，再按距离排序。城市不足 3 家时补充 80 km 内邻市；城市未知时使用 50 km → 80 km fallback，硬上限为 120 km。
- 附近模式的排序为距离、银幕大小、综合规格；三者都只作用于已建立的附近候选集，不触发 POI 查询或地理编码。
- 用户位置只保留在当前浏览器会话内存中，退出附近时移除位置 marker 并恢复全国视野。
- 页面显著展示 `@ArvinTingcn`、原始腾讯文档和 AMap 归属。
- 无 AMap 凭据时页面 fail-closed；构建、接口、静态边界和本地 mock QA 仍可运行。

## 坐标语义

运行时影院 marker 字段为 `providerLat/providerLng`，`providerCrs=GCJ-02`，直接交给 AMap JS API。前端不读取静态 `location.lat/lng`，不做坐标转换，不为 null 坐标补点。行政聚合 marker 的 label point、visual center 或组内 medoid 只用于数字 UI 锚定，不替代或改写影院坐标事实。

独立 OSM/Nominatim 审计层的 2 个 WGS84 点只作备用审计，不能与 AMap runtime layer 混用。

## 私人版差异

私人版由 `private-amap/` 提供更完整的审核详情：审核状态和位置可信度仍保留在详情层；所有 901 条同样保留列表和银幕/座位详情。私人 server 使用 `dist-private/`、环境变量和可选认证；公开版不读取这些路径。

## 验证

静态与边界验证：

```powershell
npm run build:public
npm run validate:public
node scripts/validate-public-boundary.mjs
node --test scripts/map-frontend.test.mjs scripts/public-amap-server.test.mjs
```

浏览器验收应覆盖桌面与窄屏：公开版的 901 条列表、zoom 分层行政 marker、筛选/搜索后的聚合计数、当前运行时点、无坐标详情、银幕/座位原文、附近模式和来源标注；私人版覆盖同样流程与详情。验收还应确认浏览器不发起 `DistrictSearch`、`Geocoder` 或 POI 查询。真实 AMap SDK smoke 需要 `AMAP_JS_API_KEY`（Web 端 JS Key）和 `AMAP_JS_SECURITY_CODE`；缺凭据时仍可执行本地 mock UI 验收，但不能宣称真实 SDK/代理 smoke 已通过。
