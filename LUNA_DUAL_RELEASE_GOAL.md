# Luna Goal：完成 china-imax-map 公开完整版与私人增强版

下面整份文件可直接交给 Luna 执行。

---

## GOAL START

在仓库 `2652156974-hue/china-imax-map` 当前工作区中，把现有数据工程和双地图架构收口为两个可以独立验收的成品：

1. **PUBLIC COMPLETE EDITION**：一个使用高德地图 JS API 2.0 在线渲染、可部署到公开网站的中国 IMAX 地图。全部 901 条影院都能在搜索、筛选和列表中访问；已通过现有 identity gate 的 AMap GCJ-02 坐标可以直接在高德底图中显示，不再等待 Overture/OSM 补齐，也不做 WGS84 二次转换。
2. **PRIVATE ENRICHED EDITION**：一个本机/私有访问的高德地图。继续直接使用 AMap GCJ-02，接入现有 578 个 accepted-high 位置，并把 323 条待核记录逐条形成机器可读审核结论；允许增加地址、商场/场馆、官方页面、证据链接和核验备注，但不得覆盖 @ArvinTingcn 的原始字段。

两个版本都必须为 901/901 条影院附上完整银幕宽度、高度、面积和座位源表显示文本；安全单值可以另外结构化，多值、空白和异常不得被删掉、截断或猜成单一数字。

本 Goal 要完成工程实现、数据分层、审核工具、双前端、测试、文档和发布包。不要只写方案，不要把孤立的数据不确定项当成整个项目的 global blocker。

真正需要用户决定的发布、合并、破坏性 Git 操作或来源边界问题，留到所有可独立完成的工作做完后再停下报告。

## 1. 当前仓库基线

执行前先检查真实文件、Git 状态和 schema；以下数字是 2026-08-21 的预期基线，若与工作区不一致，以工作区和审计文件为准，并先报告差异：

- 工作分支：`feat/tencent-sheet-import`
- 基线提交：`68fb045`
- Draft PR #2：未合并
- 腾讯表格范围：只包含 `BB08J2 / IMAX中国`，不是整个腾讯文档
- 在线迁移核验：`903 × 8`，其中 901 条 data rows 已逐行逐列一致
- 记录分布：大陆 881、香港 7、澳门 1、台湾 12
- `data/derived/cinemas.json`：901 条，正式坐标为 0
- `data/public/cinemas.json`：901 条；当前独立开放来源层已有 2 个 WGS84 点，但该层不再是公开高德版的发布前置条件
- 私有 AMap 审计：574 automatic high + 4 reviewed override high = 578 accepted-high
- 待核：109 automatic medium
- 未定位：194 mainland unresolved + 20 HK/Macau/Taiwan unresolved = 214
- 必须满足：`578 + 109 + 214 = 901`
- Luna 待核包：`data/local/luna-geocode-review-323.json`
- 待核包组成：109 medium + 194 mainland unresolved + 20 regional unresolved = 323
- 当前测试基线：80/80 passed
- 银幕/座位核验附件：`data/derived/screen-seat-columns.csv`
- 银幕/座位附件范围：901 条影院，包含影城名称、银幕宽度、银幕高度、银幕面积、座位数，共 4,505 个展示值
- 银幕/座位附件已与 `data/raw/arvin-imax.json` 的 `displayValue` 逐格核对：`4,505 / 4,505` 一致
- 银幕/座位附件 SHA-256：`5c6c9a14894ab985927a58de83c88dcc40cc24ecec1f807823471ed320cd91ae`

不要沿用旧聊天中“219 条逐行审核文件已经存在”或“145/39/35 已经可以逐行应用”的说法。当前仓库中没有可作为事实来源的 `geocode-risk-human-review-219.json`；不得从汇总数字反推逐行结论。

## 2. 完成定义

“公开完整版”不等于强行制造 901 个 marker。

公开版完成的定义是：

- 901/901 条影院记录均进入公开产品，可搜索、筛选、查看详情；
- 第一版直接接入现有 578 个 accepted-high AMap GCJ-02 位置；323 条待核记录只在获得合格 verdict 后增加 marker，不为覆盖率强行通过；
- 没有可靠坐标的记录继续保留 `lat=null/lng=null`，在列表中显示“未定位”；
- 公共 marker 数必须严格等于通过公共高德应用 acceptance gate 的坐标数，预期初始不少于当前 578，除非回归确认某个 accepted-high 必须撤回；
- 高德坐标只用于高德地图应用内渲染，不提供坐标批量下载、独立 GeoJSON/CSV 导出或第三方底图复用；
- 公开源码、浏览器静态资源和 Git 历史中不得出现安全密钥、Web Service key、provider cache、rawCandidates 或完整腾讯 raw 镜像；Web JS key 通过部署环境注入并绑定实际应用，安全密钥必须由服务端代理持有；
- 901/901 条公开影院详情都携带完整的银幕宽度、高度、面积和座位源表显示文本；安全单值同时提供结构化数值，多值、空白或异常值保持原文并明确显示“待核/暂无”；
- 桌面和移动端均可用，无控制台错误，来源署名明显，数据统计口径正确。

“私人增强版”完成的定义是：

- 901/901 条记录均存在；
- 现有 578 个 accepted-high 位置继续可用，除非新证据确认具体点位错误；
- 323 条待核记录全部拥有一个机器可读 review verdict，即使 verdict 是 `not-found` 或 `needs-more-evidence`；
- 每个接受的私人坐标保留真实 provider、GCJ-02、身份置信度、位置置信度和粒度；
- 901/901 条私人影院详情都携带与公开版同一事实层的完整银幕和座位数据，不因是否定位而丢失；
- 所有补充字段与源数据分离，不覆盖 Arvin 原始文本；
- 私有包可通过环境变量启动，Key、安全密钥、provider cache 和 rawCandidates 不进入 Git 或静态数据包；
- UI 明确区分 `located`、`pending-review`、`unresolved`，并显示筛选后的实时统计。

## 2A. 银幕尺寸与座位数据硬性范围

本 Goal 必须把已经核验的 901 条银幕与座位数据真正纳入公开版、私人版和 Luna 审核输入，不能只保留在孤立 CSV 中，也不能只展示成功解析出的部分。

### 权威输入与关联键

- 人工可读核验附件：`data/derived/screen-seat-columns.csv`
- 机器合并事实层：`data/derived/cinemas.json`
- 原始追溯源：`data/raw/arvin-imax.json`，只读，不进入公开构建包
- 质量审计：`data/audit/derived-quality.json`
- 所有机器关联必须使用 `sourceRow`，并在目标数据已有稳定 `id` 时同时校验 `id`。
- 禁止按影院名称或当前 CSV 行序做长期关联；名称只用于人工展示和交叉检查。
- 不修改已经核验的 5 列 CSV。若 Luna 需要带关联键的中间附件，应从 `data/derived/cinemas.json` 确定性生成新的 gitignored/local 文件，并保留原 CSV SHA-256 不变。

### 每条影院必须携带的字段

沿用现有 schema；公开版、私人版和 323 条审核包中的每条记录至少可追溯到：

```json
{
  "sourceRow": 2,
  "id": "stable-id",
  "screen": {
    "width": null,
    "height": null,
    "area": null,
    "rawWidth": "",
    "rawHeight": "",
    "rawArea": "",
    "selectionConfidence": "high|medium|low|unknown"
  },
  "seats": null,
  "seatsRaw": ""
}
```

`rawWidth/rawHeight/rawArea/seatsRaw` 必须是源表 `displayValue` 的逐字符保真副本，包括换行、繁体字、括号、破折号、加号、说明文字、尾随空白和 NBSP。结构化 `width/height/area/seats` 只是派生值，不得反向覆盖 raw 字段。

### 解析纪律

- 单一且无歧义的尺寸/座位可以填结构化数值。
- 多版尺寸、宣传值、LF Examiner、激光测距、架子尺寸、换幕前后数据不得统一按第一行、最后一行、最大值或最小值自动选择。
- 多值座位、轮椅位附加说明或历史座位数不得粗暴取第一个整数。
- 不确定时结构化值保持 `null`，但原始文本必须完整附上并在 UI 标记“待核”。
- `""`、NBSP/纯空白、人工占位符和正常文本必须区分统计，不能统一改成空字符串或 `null`。
- 宽 × 高与面积冲突时，不纠正源表，保留双方原值并加入 review reason。

### 已验证的基线分类

- 银幕宽度：451 单值、298 多值、152 空白。
- 银幕高度：440 单值、298 多值、162 空白、1 异常文本。
- 银幕面积：438 单值、297 多值、163 空白、3 异常文本。
- 三项尺寸均可直接安全解析：437 条；多值待核：298 条；已知异常：4 条。
- 座位：855 单值、38 多值/多数字、8 空白。
- 所有 901 条都必须保留字段；“空白”表示源表事实为空，不表示记录可以被省略。

### 已知回归样本

- `sourceRow=2`：香港 MY CINEMA YOHO MALL，多行尺寸必须完整保留。
- `sourceRow=51`：哈尔滨黑龙江省科学技术馆的银幕高度含“特别提示：开场前至少30分钟购票!”；必须保留原文，结构化高度保持 `null`。
- `sourceRow=796`、`835`、`865`：面积含“自测”说明，不得静默转成确定面积。
- `sourceRow=119`、`500`：宽 × 高与面积差异明显，不得擅自校正。
- `sourceRow=902`：最后一条多行尺寸必须完整保留，用于防止尾行和多行 CSV 截断。

## 3. 不可违反的规则

1. 不修改、清洗、覆盖或删除 `data/raw/arvin-imax.json`。
2. 不修改旧的 `data/cinemas.json`。
3. 不从 summary count、聊天描述或模型记忆伪造逐行审核结论。
4. 不用城市中心坐标，不按品牌名猜店，不把搜索第一候选直接当成正确结果。
5. `mall/venue` 坐标只能证明物理位置，不能冒充 exact cinema/auditorium identity。
6. Dome、球幕、GT、普通 IMAX、4D、XD 必须进行 format compatibility 检查。
7. 不为提高覆盖率放宽已冻结 matcher；若发现新系统性错误，先写 regression，再做通用修复，并单独报告。
8. 公开版可直接使用已审核的 AMap 坐标，但必须如实标记 `provider=amap`、`providerCrs=GCJ-02`，不得转换、匿名化或伪装为 OSM/Overture/Wikidata 来源。
9. AMap provider coordinate 在公开版和私人版都保持 GCJ-02，并直接绘制到高德底图；不得先转 WGS84 再画回高德。
10. 已产生的 2 个独立 WGS84 点继续保留为独立审计/备用层，不删除、不冒充 AMap，也不再阻塞公开高德版发布。
11. 不把 API key、安全密钥、token、完整 provider response、`rawCandidates` 或 `provider-cache/*.json` 写入源码、JSON、README、日志或 Git 历史。
12. Key 只从 `AMAP_API_KEY`、`AMAP_JS_API_KEY`、`AMAP_JS_SECURITY_CODE` 等环境变量读取。
13. 不绕过登录、鉴权、访问控制或地图网站接口；只使用官方公开 API、开放数据下载或普通公开网页证据。
14. 不直接合并包含 raw 快照历史的 Draft PR #2。
15. 不自动 merge，不自动 production deploy，不执行 `git reset --hard`、清理工作区或历史重写。
16. 不得为了补全银幕或座位结构化数字而猜值；全部附上指完整携带原始显示文本，不等于强制把 901 条都解析成单一数字。
17. 不得按影院名称合并银幕/座位附件；必须用 `sourceRow`，并校验稳定 `id`。
18. `data/derived/screen-seat-columns.csv` 作为内部核验附件保留，不把它作为独立批量下载文件部署到公开站点；公开站点只在逐条影院数据中携带对应派生字段并明显署名来源。
19. 高德 JS API 及地图资源必须按官方要求在线加载，不本地转存、重新打包或隐藏高德 attribution/logo。
20. 公开应用不得提供“导出全部坐标”功能，也不得把 provider cache、完整 POI 响应或 rawCandidates 暴露为静态文件/API。

## 4. 阶段 0：冻结、盘点和可恢复性

开始前：

1. 读取：
   - `PROJECT_STATUS.md`
   - `docs/PROJECT_STRUCTURE.md`
   - `docs/DATA_PIPELINE.md`
   - `docs/GEOCODING.md`
   - `docs/DATA-LICENSING.md`
   - `data/audit/project-integrity.json`
   - `data/audit/geocode-mainland-freeze.json`
   - `data/audit/geocode-mainland-quality.json`
   - `data/local/luna-geocode-review-323.json`
   - `data/derived/screen-seat-columns.csv`
   - `data/audit/derived-quality.json`
   - `scripts/extract-screen-seat.mjs`
2. 记录当前 branch、HEAD、dirty files、测试数和所有关键文件 SHA-256。
3. 不覆盖现有 freeze/audit；新结果写新文件或有版本号的输出。
4. 先运行：

```powershell
npm test
npm run check
npm run validate:derived
npm run validate:public
```

5. 生成本 Goal 的 baseline audit，例如：

```text
data/audit/luna-dual-release-baseline.json
```

至少记录 counts、hashes、Git state、network request counters 和 public/private coordinate boundary。

6. 在任何数据合并前独立确认：
   - CSV 恰好 901 条数据行；
   - `sourceRow` 2–902 在 `data/derived/cinemas.json` 中连续且唯一；
   - 901 个影院名称及 4 个银幕/座位字段与 raw `displayValue` 共 4,505 项完全一致；
   - CSV SHA-256 与上述冻结值一致；
   - 不因 CSV 多行字段把一条影院拆成多条记录。

## 5. 阶段 1：完成 323 条 Luna 人工核验

输入：

```text
data/local/luna-geocode-review-323.json
data/local/LUNA_REVIEW_PROMPT.md
```

逐条填写 `review`，不得修改 source、自动评分、query history 和现有候选事实。

允许的 verdict：

- `accept-exact`
- `accept-location-only`
- `reject-wrong-poi`
- `ambiguous`
- `not-found`
- `needs-more-evidence`

对每条记录至少核对：

- province / city / district
- current name / formerNames
- cinema brand
- mall/project/venue
- POI type
- operating/history context
- auditorium format compatibility
- 候选是否同品牌错店、同场馆错误影厅或普通商户

同时把该影院的以下事实作为只读上下文附入 323 条审核包：

- `sourceRow` / `id`
- `screen.width/height/area`
- `screen.rawWidth/rawHeight/rawArea`
- `screen.selectionConfidence`
- `seats` / `seatsRaw`

这些字段用于识别具体 IMAX 影厅和保留完整数据，不允许 Luna 在坐标 `review` 中改写。重新生成审核包后必须验证 323 条全部带齐字段，并与 901 条事实层按 `sourceRow` 精确一致。

接受结果必须包含：

```text
review.verdict
review.acceptedPoiId
review.reviewedCandidate
review.positionType
review.locationGranularity
review.locationConfidence
review.identityConfidence
review.evidenceUrls
review.reviewer
review.reviewedAt
review.notes
```

`accept-location-only` 必须明确表示商场/场馆位置，不得宣称 exact cinema identity。

无法确认时允许保留 null；但 323 条都必须有 verdict，不能静默跳过。

输出：

```text
data/local/luna-geocode-review-323.completed.json
data/audit/luna-geocode-review-323-summary.json
```

公开 summary 只能保留数量、reason tags 和无敏感必要证据；完整私人审核文件继续 gitignored。

## 6. 阶段 2：建立两个互不污染的 reviewed coordinate layer

不要直接把 323 条结果塞进 `data/derived/cinemas.json`。

建立或复用等价的双层结构：

### 2A. 私人 reviewed layer

推荐路径：

```text
data/local/private-reviewed-geocodes.json
```

优先级：

1. 新的 `accept-exact` reviewed decision
2. 新的 `accept-location-only` reviewed decision
3. 已存在 reviewed override
4. automaticHigh
5. 其他保持 null

必须保留：

- `decisionOrigin`
- `reviewVerdict`
- `provider`
- `providerPoiId`
- `providerLat/providerLng`
- `providerCrs=GCJ-02`（AMap）
- `positionType`
- `locationGranularity`
- `locationConfidence`
- `identityConfidence`
- `evidenceUrls`

### 2B. 公开高德应用 reviewed layer

公开版与私人版可以复用同一套已审核 AMap identity decision，但公开应用只暴露地图渲染所需的最小字段，不暴露完整审核证据、候选列表或缓存。

推荐的服务端/部署输入路径：

```text
data/local/public-amap-reviewed-geocodes.json
```

该文件继续 gitignored，不进入公开 Git。公开客户端通过应用自己的最小化 marker endpoint 或构建时受控注入获得当前视口/当前筛选所需数据；禁止部署一个可直接下载全部高德坐标的静态 JSON/CSV。

每条公开 AMap decision 至少包含：

```json
{
  "sourceRow": 0,
  "provider": "amap",
  "providerPoiId": "",
  "providerLat": 0,
  "providerLng": 0,
  "providerCrs": "GCJ-02",
  "positionType": "cinema-poi|venue-poi|mall-fallback",
  "locationGranularity": "auditorium|cinema|venue|mall",
  "locationConfidence": "high|medium",
  "identityConfidence": "high|medium",
  "decisionOrigin": "automatic-high|reviewed-override|luna-reviewed",
  "reviewVerdict": "accepted-high|accept-exact|accept-location-only"
}
```

公开数据最小化不等于伪造来源。popup 和审计必须明确写“位置来源：高德地图”，venue/mall 继续显示真实粒度。完整 `evidenceUrls`、query variants、reject details 和 review notes 留在私有审核层。

现有 2 个 OSM WGS84 点保留在独立文件中，可作交叉核验或未来备用；不得与 AMap GCJ-02 混成同一坐标字段，也不要求继续建设 Overture 管线才能发布。

## 7. 阶段 3：公开高德应用坐标管线

本阶段直接把现有已审核坐标层物化成高德公开应用可用的 server-side marker layer。第一版目标是使用当前 578 个 accepted-high，而不是继续等待独立开放坐标达到相同覆盖率。

取消旧方案中的 `AMAP_PUBLICATION_GATE`：不再等待单独书面许可才继续开发或形成发布候选。按已接受的高德开放平台协议、控制台应用配置和官方 JS API 接入方式推进；只有高德控制台/API 明确拒绝当前应用、要求补充认证，或用户准备实际 production deploy 时，才把对应上线步骤列为待处理项，不能阻塞其余实现与测试。

### 官方接入边界

按执行时最新官方文档实施，当前参考：

- 高德开放平台服务协议：https://lbs.amap.com/pages/terms/
- 地图 JS API 2.0 准备：https://lbs.amap.com/api/javascript-api-v2/prerequisites
- JS API 安全密钥使用：https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode
- JS API 在线加载：https://lbs.amap.com/api/javascript-api-v2/guide/abc/load

实现要求：

1. 地图 JS API 2.0 和地图资源只从高德官方地址在线加载，不下载到仓库、不与前端 bundle 混合打包。
2. 使用单独的 Web端（JS API）Key；Key 从部署环境注入并绑定实际应用/域名，不提交到源码。
3. `AMAP_JS_SECURITY_CODE` 仅由服务端或边缘代理持有，按官方推荐代理 `/_AMapService`；浏览器源码、静态配置、日志和 Git 中必须为 0。
4. 用户此前在聊天中粘贴过的安全密钥视为已暴露；这不阻塞本地开发，但正式上线前必须在高德控制台轮换安全密钥并更新部署环境。
5. 高德 logo、版权和 attribution 保持可见，不覆盖、不裁切。
6. 不提供坐标导出、离线地图、瓦片代理、本地资源镜像或第三方底图叠加复用。

### 坐标纳入优先级

1. 新的 `accept-exact` reviewed decision
2. 新的 `accept-location-only` reviewed decision
3. 已存在 reviewed override
4. automaticHigh
5. automaticMedium/unresolved 保持 null，直到得到合格人工 verdict

候选接受硬条件保持不变：

- province/city/admin compatible
- POI 是目标影院、场馆或明确商场主体
- brand + project/store identity 兼容
- auditorium format compatible
- 无 hard reject
- 无真实歧义，或已由人工 evidence review 消除歧义

粒度优先级：

```text
exact auditorium
→ exact cinema
→ verified parent venue
→ verified mall fallback
→ null
```

不得因坐标距离接近或同品牌而单独确认 identity。公开使用高德不意味着放宽 matcher，也不意味着把 323 条待核记录直接通过。

### 物化与服务

- 从现有 freeze/audit 和 reviewed layer 确定性生成 `data/local/public-amap-reviewed-geocodes.json`。
- 第一轮物化不得发起新的 Web Service 请求；只用现有 578 accepted-high 和 cache/review 事实。
- marker service 只返回当前 UI 必需字段；不返回 rawCandidates、queryVariants、hardReject details、完整地址候选或安全凭据。
- 若采用静态托管无法安全代理 JS API 安全密钥，改用带 edge/serverless function 的托管方式；不要把安全密钥明文塞进静态 HTML。
- 公共 marker layer 与完整 Arvin 数据层按 `sourceRow` 合并，禁止按影院名关联。

### 输出

至少生成：

```text
data/local/public-amap-reviewed-geocodes.json
data/audit/public-amap-quality.json
data/audit/public-amap-unresolved.json
```

审计统计：

- total 901
- automaticHigh
- reviewedOverrideHigh
- lunaReviewedExact
- lunaReviewedLocationOnly
- unresolvedPublic
- auditorium/cinema/venue/mall
- GT/Dome/12-channel coverage
- mainland/HK/Macau/Taiwan coverage
- duplicate providerPoiId groups
- cityMismatch/formatConflict/ambiguity/rejected counts
- static bulk coordinate artifacts exposed = 0
- security code findings = 0

不要求 901/901 marker；要求当前可靠坐标尽快上线，剩余记录继续在列表中保留。

## 8. 阶段 4：生成真正的公开完整版

公开产品改用高德地图 JS API 2.0，与私人版共享成熟的 AMap marker/cluster 基础，但公开版只展示最小必要字段，不开放审核后台和私人证据。

公开数据构建器必须：

1. 以 `data/derived/cinemas.json` 为事实/派生基础。
2. 从公开高德应用 reviewed layer 合并已接受的 AMap GCJ-02 坐标；不转换为 WGS84。
3. 允许 partial coordinate coverage。
4. 对没有接受坐标的影院保留完整 metadata 和 null coordinate。
5. 对 901 条全部合并 `screen.rawWidth/rawHeight/rawArea`、`seatsRaw` 和安全派生的 `screen.width/height/area`、`seats`；即使坐标为 null，也不得丢失银幕或座位字段。
6. 允许公开应用内部使用：
   - `provider=amap`
   - `providerCrs=GCJ-02`
   - 通过 acceptance gate 的 `providerLat/providerLng`
7. 永远拒绝向公开客户端或静态包输出：
   - rawCandidates/rankedCandidates
   - provider cache
   - query variants / hardReject candidate details
   - `AMAP_API_KEY` / `AMAP_JS_SECURITY_CODE`
   - 可下载的全部坐标 CSV/GeoJSON
8. 输出不含坐标的 901 条公共事实数据，以及由服务端 marker layer 提供的最小坐标响应和明确质量摘要。

### 公开 UI 必须完成

- 901 条均进入本地搜索和侧边列表
- marker clustering
- 搜索当前名称、formerNames、城市、省份、商场/场馆字段
- region 筛选：大陆、香港、澳门、台湾
- system 筛选：GT Laser、Commercial Laser、Laser XT、Xenon、Dome、Unknown
- 12 声道筛选
- open/closed/temporarily_closed/unknown 筛选
- exact cinema / venue / mall granularity 筛选
- 无坐标记录仍可打开详情，显示“未定位”
- popup 显示影院名称、城市、投影、声道、尺寸、座位、状态、位置粒度、位置可信度和真实坐标来源
- 详情中的银幕信息必须分别展示宽度、高度和面积；单值可用结构化数字，多值或异常值展示完整 raw 多行文本并标“待核”，不得截断为第一行
- 座位信息必须覆盖 901 条：单值显示结构化整数；多值/说明文本显示完整 `seatsRaw` 并标“待核”；源表为空时显示“暂无”，不得显示猜测数字
- 无坐标记录打开详情时仍必须显示完整银幕与座位信息
- venue/mall 明示“场馆/商场坐标，非影院入口精确定位”
- 顶部显示：`已定位 X / 901 · 待核 M · 未定位 U`
- 筛选后显示动态统计，例如：`GT Laser · 已定位 A / 8`
- 明显展示 `@ArvinTingcn《全球IMAX及特效影厅分布》` 和腾讯文档链接
- 高德 logo、版权和 attribution 始终可见
- Web JS key/代理配置缺失时 fail closed，并显示明确配置错误；不得静默切换到错误坐标系或城市中心
- 桌面与移动端可用

公开版和私人版可以共享同一个 578/109/214 坐标事实口径；区别在于公开版只暴露最小地图字段，私人版保留审核证据和 supplemental 数据。

### 公开发布包

建立一个确定性的公开构建命令，例如：

```powershell
npm run build:public
npm run start:public
npm run validate:public
```

保持简单原生前端，不为形式引入 React/Vue。公开部署必须包含一个最小 edge/serverless proxy 来保护 JS API 安全密钥，并包含最小 marker service；若创建 `dist-public/`，必须明确客户端文件与服务端私有部署输入的边界。

## 9. 阶段 5：完成私人增强版

私人版继续使用：

```text
AMap JS API
+ GCJ-02 accepted coordinates
+ private/local reviewed layer
+ environment-only credentials
```

公开版和私人版都使用高德底图与 GCJ-02；私人版额外拥有完整审核证据、候选上下文和 supplemental 数据。

### 私人补充数据

允许在独立 `supplemental` 或等价对象中增加：

- normalizedAddress
- mallOrVenue
- district
- officialUrl
- ticketing/operatorUrl（仅作证据）
- evidenceUrls
- lastVerifiedAt
- reviewNotes
- currentIdentityAssessment

不得覆盖或改写：

- `projection.raw`
- `nameRaw`
- `screen.rawWidth/rawHeight/rawArea`
- `seatsRaw`
- 原始历史文本
- sourceRow/source attribution

私人数据构建也必须为 901/901 条附上 `screen.rawWidth/rawHeight/rawArea` 与 `seatsRaw`。定位状态不能决定这些字段是否存在；medium、unresolved 和无 marker 记录同样必须在侧边列表详情中可查看。

来源冲突时保留冲突和 review 状态，不替 Arvin “纠正”原始内容。

### 私人 UI 只做一轮收口，不大重构

保留当前高德地图、筛选、搜索、popup 和 MarkerCluster。完成三项 polish：

1. **减轻 cluster**：低缩放采用浅底、深字、细边框；阴影至少明显降低，不让全国图被黑色大圆压住。
2. **压缩左栏顶部**：合并重复的 PRIVATE AMAP VIEW 提示，建议显示为：

   ```text
   私人地图 · 已定位 X / 901
   高德 GCJ-02 · 含私人审核增强信息
   ```

3. **筛选反馈**：筛选 GT Laser、Dome、12 声道、系统或区域后，统计和 cluster 数量只反映当前结果。

私人状态必须区分：

- `located`
- `pending-review`
- `unresolved`

不得把 109 medium 与 214 unresolved 合并成同一种事实。审核完成后，数字以 review 结果重新计算。

私人 popup 至少显示：

- 影院名称
- 城市
- 投影系统
- 声道
- 银幕尺寸
- 银幕面积及完整多行原始尺寸（存在多值/异常时）
- 座位数或完整 `seatsRaw`（多值/说明文本不得截断）
- 营业状态
- locationGranularity
- locationConfidence
- identityConfidence
- geocodeSource
- 补充来源/核验时间

### 私人构建与安全

继续支持：

```powershell
npm run build:private
npm run start:private
npm run stop:private
```

必须验证：

- `dist-private/` gitignored
- `data/local/` gitignored
- provider cache gitignored/untracked
- browser 可以得到 Web JS key，但 `AMAP_JS_SECURITY_CODE` 只留在 server proxy
- 静态 JSON、日志、manifest 和 Git diff 中没有真实 credential
- 非 loopback 部署缺少认证时 fail closed
- private bundle 不包含完整 provider response/rawCandidates

## 10. AMap 配额保护

读取 `data/audit/amap-quota-guard.json`，以其和用户当前说明为准。

当前已知月额度基线：

- monthly quota：5000 requests
- 此前约已消耗：1500
- 本 Goal 新 AMap Web Service 请求硬上限：600

规则：

- cache-first always
- 不重跑 881 full query
- 不刷新已成功 AMap query
- 公开首版物化只读取现有 reviewed/cache 结论，不因发布而重新请求 578 条
- 只有 unresolved 且 cache/evidence 明显不足时才允许新的 Web Service POI 请求
- 在第一次新请求前输出计划 request 数和剩余预算
- 达到 600 立即停止 AMap querying
- 香港/澳门/台湾不得消耗大陆 AMap budget
- unresolved 可以保留 null
- 最终精确报告 new requests、cache hits、errors 和估算月额度剩余
- 浏览器地图瓦片/JS API 运行流量与本段 600 次 Web Service POI 搜索预算分开统计；公开上线后必须在高德控制台监控其实际配额和告警

不要为了“补充数据”把同一影院换十种 query 重复轰 API。

## 11. 自动化测试和质量验收

原 80 项测试必须全部继续通过，并为双版本增加边界测试。

至少验证：

### 数据

- raw SHA-256 unchanged
- derived 901、public 901、private 901
- sourceRow 唯一、连续、无重复
- JSON schema 全部通过
- 无 `NaN`、Infinity、非法 lat/lng
- public/private AMap marker 都只使用 GCJ-02 provider coordinates
- 无 double conversion
- public 已采用坐标的 `provider=amap` 和 `providerCrs=GCJ-02` 标记 100% 准确
- public rawCandidates/provider cache count = 0
- private marker 数 = private accepted coordinate 数
- public marker 数 = public accepted coordinate 数
- location-only 不得具有 exact identity 声明
- `data/derived/screen-seat-columns.csv` 恰好 901 条，并保持冻结 SHA-256
- 901 个名称 + 901 × 4 个银幕/座位字段共 4,505 项与 raw `displayValue` 完全一致
- derived、public、private 三层的 901 条记录都存在 `rawWidth/rawHeight/rawArea/seatsRaw` 键；按 `sourceRow` 比对内容 3,604 / 3,604 一致
- public/private 中即使坐标为 null，也不得删除银幕或座位字段
- 多行和 NBSP round-trip 后逐字符一致，CSV 不得把多行单元格拆行
- 298 条多值尺寸不得因构建流程自动选择第一/最后/最大/最小值
- 38 条多值/多数字座位不得被粗暴取第一个整数
- `sourceRow=51/119/500/796/835/865` 的异常或冲突保持原文和 review 状态
- 银幕/座位合并过程不得使用名称作为主键

### Matcher / review regression

- 九原等“原”地名不退化
- county-level city hierarchy 不退化
- hardReject 不参与 ambiguity
- ordinary merchant 不能成为 mall fallback
- AMap typecode classifier 不退化
- auditorium format compatibility 不退化
- 山东科技馆 sibling auditorium case 不退化
- 乌鲁木齐 row 785/786 不得错误合并

### 前端

- public AMap JS API 2.0 页面加载成功
- private AMap 页面加载成功
- 桌面建议至少 `1440×900`
- 移动端建议至少 `390×844`
- 搜索、每个筛选、cluster click、popup、无坐标列表项均实测
- 筛选后 marker/cluster count 与数据一致
- 无控制台 error
- attribution 可见
- source link 可点击
- public/private 页面的安全代理请求成功
- 至少对单值、多行尺寸、空白尺寸、异常尺寸、单值座位、多值座位和空白座位各做一条 public/private UI 回归；完整原文可见且不溢出 popup/详情面板

### 安全和 Git 边界

- credential scan 0 findings
- `git check-ignore` 确认 cache/local/dist-private
- 公开客户端构建包中不存在 raw、cache、private review、安全密钥或 Web Service key；允许存在运行时注入的 Web JS key 标识和最小 AMap marker 响应
- 公开静态目录中完整 AMap 坐标 CSV/GeoJSON/JSON 数量 = 0
- `AMAP_JS_SECURITY_CODE` 在浏览器源码、静态响应、日志和 Git diff 中命中数 = 0
- 高德 JS API/瓦片本地镜像数量 = 0
- `git diff --check` 通过
- `npm run check` 通过；仅允许明确记录的 release warnings

生成：

```text
data/audit/luna-dual-release-final.json
data/audit/public-release-readiness.json
data/audit/private-release-quality.json
```

## 12. Git 与交付策略

当前工作树已有大量未提交文件，先保护现有改动，不要 reset/clean/checkout 覆盖。

开发过程中可以修改项目文件和生成 gitignored private artifact，但：

- 未经用户在 Luna 线程中明确授权，不 commit、不 push
- 不 merge Draft PR #2
- 不 production deploy
- 不做历史重写

最终准备两套清单：

1. **Public release manifest**：只列出公开源码、public dataset、公开 provenance/audit、测试和文档。
2. **Private local manifest**：列出本机运行包、private reviewed data、cache 和凭据环境要求；这些文件不得进入公开 Git。

公开发布分支最终应从干净 `main` 创建，并选择性带入 publication-safe 文件，避免完整 raw 镜像进入 public history。只准备步骤和 PR 描述；等待用户批准后再执行实际合并/部署。

## 13. STOP CONDITIONS

以下情况只阻塞对应记录或阶段，不阻塞其他工程工作：

- 某条影院身份不确定 → 保持 null/review，继续下一条
- 某 provider 暂时失败 → 使用 cache/其他合法来源或记录 unresolved
- 某条坐标 identity 不清晰 → 不纳入 marker，仍保留影院详情并继续其他工作
- Luna review 某条证据不足 → verdict=`needs-more-evidence`，继续其他条目

只有以下情况才停止并请求用户：

1. 需要 merge、production deploy、公开域名/托管平台选择。
2. 需要 commit/push，而当前线程没有明确授权。
3. 需要 destructive Git operation 或历史重写。
4. 需要超过 600 个新 AMap 请求。
5. 本地实机加载需要 credential 但环境变量不存在；此时完成 mock/构建/边界测试并只暂停真实地图 smoke test。
6. 继续必须猜测数据事实或伪造证据。
7. 发现可能影响大量已接受坐标的新系统性 false-positive，必须先让用户审阅风险范围。

不要因为个别 unresolved 停止整个 Goal。

## 14. 最终报告

完成后用清晰表格报告：

### 公共版

- total records
- public coordinates
- public coverage
- high / reviewed-medium / unresolved
- auditorium / cinema / venue / mall
- AMap automatic-high / reviewed-override / Luna-reviewed counts
- mainland / Hong Kong / Macau / Taiwan coverage
- GT Laser / Dome / 12-channel coverage
- public marker count
- public AMap GCJ-02 coordinate count
- standalone bulk coordinate artifacts exposed
- JS API security proxy result
- build/test result
- deploy-ready yes/no
- screen raw fields attached / 901
- seats raw fields attached / 901
- screen single / multivalue / blank / abnormal counts
- seats single / multivalue / blank counts
- screen-seat raw comparison matched / 3,604

### 私人版

- total records
- located / pending-review / unresolved
- exact / location-only
- 323 verdict 分类数量
- AMap automaticHigh / reviewed accepted / rejected
- private marker count
- supplement fields coverage
- new AMap requests / cache hits / errors
- estimated monthly quota remaining
- screen raw fields attached / 901
- seats raw fields attached / 901
- null-coordinate records with screen/seat details available

### 边界

- raw unchanged
- public AMap marker count
- public standalone AMap bulk dataset count
- public AMap provenance correctness
- secrets found
- private files tracked count
- Draft PR status
- commit/push/merge/deploy actions taken
- 仍需用户处理的精确清单

只有当双版本均通过对应 validator、80 项原回归不退化、所有新增测试通过、公开/私有边界为 0 泄漏时，才能把 Goal 标记为完成。

## GOAL END
