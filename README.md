# 中国 IMAX 银幕地图

一个面向影迷的中国 IMAX 影院交互地图，目标是把影院位置、放映系统、银幕尺寸、画幅、声道等信息放到同一张地图上，方便筛选和比较。

## 从这里开始

- 当前完成度、坐标计数和下一步：[`PROJECT_STATUS.md`](PROJECT_STATUS.md)
- 项目目录与公开/内部/私有边界：[`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)
- 数据分层：[`data/README.md`](data/README.md)
- 构建与验证命令：[`scripts/README.md`](scripts/README.md)

```powershell
npm test
npm run check
```

Windows 公开/私人高德地图都只从 Windows 用户环境变量读取真实凭据。公开版可运行 `npm run start:public`，私人版可双击 `START_PRIVATE_MAP.cmd`，分别用 `npm run stop:public` / `STOP_PRIVATE_MAP.cmd` 停止。

## 数据来源与授权

影院规格数据计划主要使用：

- **@ArvinTingcn** 整理维护的《全球 IMAX 及特效影厅分布》
- 原始文档：https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP
- 微博：https://weibo.com/6729835778

2026-08-18，原资料维护者公开回复同意用于 IMAX 屏幕地图可视化，条件是**在明显位置展示来源**。因此网页主界面会持续保留醒目的数据来源标注。

本项目只对授权数据进行格式转换、字段规范化、筛选和地图可视化，不声明拥有原始影院数据的著作权。IMAX 名称及相关商标归其权利人所有，本项目与 IMAX Corporation 及各影院不存在隶属或商业合作关系。

## 当前状态

### v0.4

- 重做地图界面与中文排版
- 公开版和私人版都切换为高德 JS API 2.0，使用 GCJ-02，不做 WGS84 二次转换
- 在主界面显著展示 @ArvinTingcn 与原始文档来源
- 改进搜索、筛选、弹窗和移动端显示
- 覆盖目标明确包含：中国大陆、香港、澳门、台湾
- 网站读取由构建器生成的 [`data/public/cinemas.json`](data/public/cinemas.json) 901 条静态事实，再由公开 server 的 `/api/public/markers` 在运行时返回 901 个最小 GCJ-02 点；当前验收为 accepted=901、markerCount=901、unlocated=0，其中身份精确 801、场所级定位 100。内部规则派生层为 [`data/derived/cinemas.json`](data/derived/cinemas.json)，旧的 [`data/cinemas.json`](data/cinemas.json) 保持未修改，仅作为历史演示文件
- 增加投影系统、Dome、12 声道、营业状态筛选，以及基于行政归属的自定义聚合 marker；按 `zoom ≤ 5` 省级、`5–7` 地级行政区（直辖市直达区县）、`7–9` 县区、`≥9` 逐步单影院显示，位置粒度保留在详情层，不再作为普通用户主筛选
- 筛选和搜索先作用于影院集合，再重新计算省、市、县区聚合计数；行政 marker 的视觉锚点优先使用 label point，其次 visual center，最后使用组内 medoid，不改变影院坐标事实。当前发布层尚无经项目审计的行政中心点或 polygon，真实记录会明确使用 medoid fallback，不冒充官方中心。当前层级缺少精确行政绑定的少量影院直接显示为单影院 marker，不猜区县，也不回退成竞争视觉注意力的上一级数字圆。行政归属仅在本地构建阶段从 provider cache 提取最小绑定，浏览器不接收 raw candidates，也不发起 DistrictSearch、Geocoder 或 POI 查询
- 增加用户主动触发的“我的位置 / 附近 IMAX”：先按城市或距离建立候选集，再提供距离、银幕大小、综合规格三种排序，不调用影院 POI 查询
- 最终 canonical layer 已接受 901 / 901 条；历史 review snapshot 仅保留为 `historical-non-blocking` provenance，不再与当前 `0 unresolved` 并列作为发布门
- 正常单值宽度/高度/面积/座位按格式化数字显示并去除无意义尾零；空白或 NBSP 显示 `暂无数据`；多值/异常显示 `待核`，原文只保留在默认折叠的 `数据说明` 中，raw 仍只在数据层保留
- 公开发布分支 `codex/public-release` 从 clean baseline `fba4dcd` 创建，排除 `data/raw/`、provider cache、`data/local/`、私有包和完整坐标导出；运行层装配时通过环境变量 `PUBLIC_AMAP_REVIEWED_SOURCE_FILE` 从外部安全位置注入 reviewed marker source，构建后的最小 layer 仍为 gitignored；当前只保留本地分支，不自动 push、merge 或 deploy
- 本地 QA 可运行 `node scripts/build-local-preview.mjs` 后用 `index.html?preview=local` 查看旧审计预览；该模式明确标注 `LOCAL PREVIEW · NOT FOR PUBLICATION`，生成的 `data/local/` 已被 gitignore
- 私人高德运行出口由 `node scripts/build-private-amap-release.mjs` 生成 gitignored 的 `dist-private/`，保留审核状态和更完整证据；完整说明见 [`docs/AMAP_PRIVATE_RELEASE.md`](docs/AMAP_PRIVATE_RELEASE.md)

## 腾讯文档原始抓取验证

- 来源：@ArvinTingcn 维护的公开腾讯文档表格，目标 tab 为 `BB08J2`（`IMAX中国`）。
- 抓取方式：使用 Chromium/Playwright 渲染普通访客页面，确认表格主体由 Canvas 工作区绘制；页面初始加载包含 `/dop-api/opendoc` JSONP 请求，但脱离浏览器上下文的无 cookie 重放返回 401，因此只读取页面正常加载的只读运行时工作表对象。
- 访问边界：未登录腾讯文档，未读取或伪造 cookie/token，未调用复制或导出能力，未修改文档内容或权限。
- 原始结果：见 [`data/raw/arvin-imax.json`](data/raw/arvin-imax.json)。该文件保留工作表行列、单元格原始值、显示值、编辑值、类型和数值格式，并记录来源与抓取元数据。
- `data/cinemas.json` 在本次验证中未修改；人工检查原始结果前不进行正式导入。
- 地图产品应在明显位置继续标注 `@ArvinTingcn` 与原始腾讯文档来源。

### 腾讯文档全量迁移完整性审计（2026-08-20）

- 审计范围严格限定为 `BB08J2`（`IMAX中国`），不是整个腾讯文档。当前文档另有 7 个工作表，均未抓取。
- Chromium 普通访客只读运行时复核结果：`903 × 8`，`rowIndex` 连续 `0–902`，无缺行、增行、重复行；标题行、表头和最后一行均已核对。
- 逐单元格比较 `rowIndex`、`colIndex`、`displayValue`、`rawValue`、`editValue`、`typeCode`、`typeName`，结果无差异；规范化换行后的内容哈希为 **901 / 901 data rows matched**。
- 独立缺失值分类、分层抽样和已知特殊样本检查见 [`data/audit/arvin-imax-20260820.json`](data/audit/arvin-imax-20260820.json)；逐行 SHA-256 见 [`data/audit/arvin-imax-20260820-row-hashes.json`](data/audit/arvin-imax-20260820-row-hashes.json)。
- 字段复杂度审计仅记录混合类型、富文本、超长多行文本、换行、空白和超链接分布，不做清洗、截断、去空格或类型强转。
- 本次审计未覆盖其他工作表，未登录、未伪造 cookie/token、未调用复制/导出，未覆盖原始 JSON，且 `data/cinemas.json` 保持不变。

## 派生数据层与规则审计（2026-08-20）

派生层只以 `data/raw/arvin-imax.json` 为输入，不把原始快照作为网页数据源，也不覆盖原始快照。可重复生成：

```text
node scripts/derive-cinemas.mjs
```

生成文件：

- [`data/derived/cinemas.json`](data/derived/cinemas.json)：901 条地图派生记录；保留 `projection.raw`、`nameRaw`、`screen.rawWidth/rawHeight/rawArea`、`seatsRaw`。
- [`data/derived/review-needed.json`](data/derived/review-needed.json)：无法安全推导、需要人工确认或尚未可靠定位的记录及原因代码。
- [`data/derived/cinemas.schema.json`](data/derived/cinemas.schema.json)：派生数据结构约束。
- [`data/audit/projection-vocabulary.json`](data/audit/projection-vocabulary.json)：901 行投影/声道原始词汇扫描、出现次数、标准化结果和未识别项目。
- [`data/audit/status-parsing.json`](data/audit/status-parsing.json)：按日期优先、源表行序辅助的营业状态解析审计。
- [`data/audit/derived-quality.json`](data/audit/derived-quality.json)：质量统计、结构检查和分层抽样样本。

当前派生统计：901 条均生成。营业状态为 `open 97`、`closed 8`、`temporarily_closed 1`、`unknown 795`；主投影系统为 `Xenon 669`、`Commercial Laser 105`、`Laser XT 113`、`GT Laser 8`、`unknown 6`；Dome 是独立维度，共 8 条；12 声道 102 条。城市前缀安全匹配 901 条，其中中国大陆 881、香港 7、澳门 1、台湾 12。状态解析按日期排序；例如 row 59 的“结束运营”后有 2024 年“重装启幕”，因此当前规则派生为 `open`，而不是把最后一个关闭事件永久化。

银幕尺寸只接受安全的单一数值：437 条记录的宽度、高度、面积三列均可直接解析；298 条含多值尺寸且没有自动选择；0 条多值尺寸被自动选择；4 条含异常非数值文本；2 条存在面积一致性差异并保留源值、不做纠正。哈尔滨黑龙江省科学技术馆的提示文本不会被解析成高度。

正式规则派生层仍不写入坐标，因此不伪造 `data/derived` 坐标；公开/私有运行层则分别使用经过验收的 GCJ-02 marker。港澳台区域审计仍保留在 [`data/audit/geocode-hkmo-tw.json`](data/audit/geocode-hkmo-tw.json)，不会改写派生层。

### POI 坐标审计

- 大陆 POI 主 provider 适配器为高德 Web Service 关键字搜索；官方接口说明见 [高德搜索 POI 文档](https://lbs.amap.com/api/webservice/guide/api/search/)。
- 凭据只从当前进程环境变量 `AMAP_API_KEY` 读取；不得写入源码、JSON、README、日志或 Git 历史。当前仓库不保存密钥值。
- 20 条 matcher 回归使用 `node scripts/geocode-poi.mjs --cache-only --limit=20`：它只重算已有缓存，不读取 API key、不发起网络请求，也不写入 `data/derived/cinemas.json`。该脚本的 `--full` 与所有 runner 的 `--apply` 仍被程序明确禁用。
- 适配器位于 `scripts/geocode/providers/`；影院分类优先依据 AMap `typecode`，候选按适用证据重新归一化评分，并在 hard reject 之后判断真实歧义。商场 fallback 只允许商场/购物中心自身 POI；不使用商户或城市中心坐标。
- AMap 原始坐标以 GCJ-02 保留为 `providerLat/providerLng`，公开/私人 AMap 页面直接使用；同时记录 `providerCrs`、`positionType`、来源和置信度。位置审计另行区分 `locationGranularity`（auditorium/cinema/venue/mall）、`locationConfidence` 与 `identityConfidence`；场馆主体坐标不得冒充精确影厅身份。20 条重算结果、逐条前后差异分别见 [`data/audit/geocode-test-20.json`](data/audit/geocode-test-20.json) 与 [`data/audit/geocode-matcher-diff.json`](data/audit/geocode-matcher-diff.json)。本阶段没有全量请求或坐标写入。
- 独立 blind-50 使用固定 seed、固定 sourceRows 和 matcher SHA-256 锁。`node scripts/geocode-blind-50.mjs --selection-only` 只重建样本；`node scripts/geocode-blind-50.mjs --cache-only` 仅使用已有缓存重算，缓存缺失时立即失败，不读取 key 或回退到网络。匹配器会拒绝与源投影不兼容的 Dome/球幕、GT/巨幕、4D、XD sibling auditorium，并按省、地级市、县级行政区三层校验县级市候选；县级市映射与依据见 [`data/geocode/mainland-admin-hierarchy.json`](data/geocode/mainland-admin-hierarchy.json)。公开结果及两轮修复差异见 [`data/audit/geocode-blind-50.json`](data/audit/geocode-blind-50.json)、[`data/audit/geocode-blind-50-format-diff.json`](data/audit/geocode-blind-50-format-diff.json) 和 [`data/audit/geocode-blind-50-admin-diff.json`](data/audit/geocode-blind-50-admin-diff.json)。
- 大陆全量只允许显式运行 `node scripts/geocode-mainland.mjs --scope=mainland --dry-run`。`574 automatic high / 109 automatic medium / 4 reviewed override high / 194 unresolved` 是历史冻结审计基线，不是当前发布计数；当前发布计数以 [`data/audit/public-release-readiness.json`](data/audit/public-release-readiness.json) 为准：901 accepted、901 marker、0 unresolved、0 unlocated。
- `data/geocode/provider-cache/*.json` 是本地私有工作缓存，已由 `.gitignore` 排除，不应进入公开 Git 历史。缓存包含第三方 API 原始候选响应；公开 audit 不复制完整候选列表。
- `data/local/cinemas-preview.json` 是同样的本地私有预览层，只包含已有 `accepted-high` 选中结果（含现存 reviewed override）；它不是人工审核结论，不得当作 public dataset。
- 私有高德运行包由 `scripts/build-private-amap-release.mjs` 从该本地层生成：完整保留 901 条记录，901 条以 GCJ-02 绘制，pending-review=0、unresolved=0、unlocated=0；`accepted + unlocated = 901` 且 `markerCount = accepted`。`dist-private/`、Key 与安全密钥均不进入公开 Git。
- 港澳台不占用大陆 AMap 配额；独立区域审计命令为 `node scripts/geocode-regional.mjs --scope=regional --provider=nominatim --network --max-new=20`。Nominatim 坐标为 WGS84，区域审计只写 `data/audit/geocode-hkmo-tw.json`，不会自动改写 `data/derived/cinemas.json`。

### 冻结基线与人工审核闸门

- 历史 mainland 冻结基线为 `574 automaticHigh / 109 automaticMedium / 4 reviewedOverrideHigh / 194 unresolved`，见 [`data/audit/geocode-mainland-freeze.json`](data/audit/geocode-mainland-freeze.json)。冻结期间不重新请求、不刷新成功缓存、不修改 matcher、scoring、query 或 CRS；当前发布层以动态 reviewed-layer 审计为准。
- 逐行 Luna review snapshot 仍只作为历史 provenance；其 `needsMoreEvidence/reviewComplete:false` 已明确标为 `historical-non-blocking`，当前发布门只读取最终 901/901 canonical layer。
- AMap 月度配额保护见 [`data/audit/amap-quota-guard.json`](data/audit/amap-quota-guard.json)：本轮新请求为 `0`，大陆新请求预算上限为 `600`，港澳台不占用该预算。公开地图通过官方 AMap JS API 2.0 website/H5 runtime 显示 901 个 GCJ-02 点；生产前仍需完成控制台域名/账户合规检查，见 [`docs/DATA-LICENSING.md`](docs/DATA-LICENSING.md)。
- 对 5 条 GT/Dome/历史影院高价值未定位记录补充了官方或运营方证据索引，见 [`data/audit/geocode-mainland-evidence-review.json`](data/audit/geocode-mainland-evidence-review.json)；该审计不应用坐标、不新增 override，记录仍保持 null。
- 公开层必须由 [`scripts/build-public-release.mjs`](scripts/build-public-release.mjs) 从内部层显式生成；静态层不含坐标，运行时 marker 层只返回 901 个最小 AMap GCJ-02 字段，不复制 raw 快照、provider cache 或完整第三方候选响应。

数据边界：原始事实是源表显示文本、来源、行号和原始字段；投影标准化、城市前缀、状态、银幕单值解析和 `id` 是规则派生；多值尺寸、无法识别投影、状态不明、名称历史歧义和未定位记录必须人工核验。`review-needed.json` 的原因计数是可重叠的，不应相加为记录总数。

### 合并前的 raw 快照处理

当前 feature 分支的历史包含内部审计用 raw mirror；公开发布已改为从 clean baseline `fba4dcd` 创建 `codex/public-release`，只挑选公开安全的派生层、审计摘要、脚本和网页提交，确认公开历史不包含完整 raw 镜像。当前不删除本地 raw，也不自动 push、merge 或 deploy。

## 技术栈

- AMap JavaScript API 2.0 + 自定义行政层级 marker（省 → 地级市 → 县区 → 影院）
- Node.js server-side marker endpoint and `/_AMapService` security proxy
- 静态 HTML + JSON facts + runtime GCJ-02 marker response
- 可部署到公开网站/H5；正式生产需使用服务端 secret 管理和域名白名单

## 数据字段

派生字段按 `cinemas.schema.json` 约束，主要包括：

`id, sourceRow, name, formerNames, region, province, city, projection, screen, seats, status, historySummary, location, source`

原始表的完整内容只在内部 raw 快照和审计范围内保留；网页只读取 derived 记录。

## 数据原则

1. 原始文档数据优先，页面不得把推测值伪装成实测值。
2. 银幕尺寸、设备升级、停业等会变化，需保留更新时间。
3. 不因技术实现方便而遗漏香港、澳门、台湾影院。
4. 对来源冲突的数据标注“待核”，不强行覆盖。
5. 网站代码与视觉设计可以独立演进，但原始影院数据始终保留来源署名。

## 下一步

1. 使用 `npm run start:public` 配置 Web 端 JS Key 与 server-only 安全密钥，完成真实 AMap SDK smoke
2. 对剩余 323 条逐行审核，审核通过后按 `sourceRow/id` 增加 marker，不改写 raw 数据
3. 人工检查 `data/derived/review-needed.json`，尤其是多值尺寸、状态和未识别投影
4. 正式 production deploy 前轮换安全密钥，并完成高德控制台域名与账户/商业状态检查
