# 中国 IMAX 银幕地图

一个面向影迷的中国 IMAX 影院交互地图，目标是把影院位置、放映系统、银幕尺寸、画幅、声道等信息放到同一张地图上，方便筛选和比较。

## 数据来源与授权

影院规格数据计划主要使用：

- **@ArvinTingcn** 整理维护的《全球 IMAX 及特效影厅分布》
- 原始文档：https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP
- 微博：https://weibo.com/6729835778

2026-08-18，原资料维护者公开回复同意用于 IMAX 屏幕地图可视化，条件是**在明显位置展示来源**。因此网页主界面会持续保留醒目的数据来源标注。

本项目只对授权数据进行格式转换、字段规范化、筛选和地图可视化，不声明拥有原始影院数据的著作权。IMAX 名称及相关商标归其权利人所有，本项目与 IMAX Corporation 及各影院不存在隶属或商业合作关系。

## 当前状态

### v0.3

- 重做地图界面与中文排版
- 将底图切换为 OpenStreetMap 标准瓦片，避免上一版 CARTO 英文底图体验
- 在主界面显著展示 @ArvinTingcn 与原始文档来源
- 改进搜索、筛选、弹窗和移动端显示
- 覆盖目标明确包含：中国大陆、香港、澳门、台湾
- 网站现在读取 [`data/derived/cinemas.json`](data/derived/cinemas.json)；旧的 [`data/cinemas.json`](data/cinemas.json) 保持未修改，仅作为历史演示文件
- 增加投影系统、Dome、12 声道、营业状态筛选，以及基于 Leaflet MarkerCluster 的点位聚合
- 未经严格名称+城市匹配的坐标保持 `null`，网页会明确显示待定位数量，不使用城市中心点代替影院坐标

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

当前派生统计：901 条均生成。营业状态为 `open 98`、`closed 9`、`temporarily_closed 1`、`unknown 793`；主投影系统为 `Xenon 669`、`Commercial Laser 105`、`Laser XT 113`、`GT Laser 8`、`unknown 6`；Dome 是独立维度，共 8 条；12 声道 102 条。城市前缀安全匹配 901 条，其中中国大陆 881、香港 7、澳门 1、台湾 12。

银幕尺寸只接受安全的单一数值：437 条记录的宽度、高度、面积三列均可直接解析；298 条含多值尺寸且没有自动选择；0 条多值尺寸被自动选择；4 条含异常非数值文本；2 条存在面积一致性差异并保留源值、不做纠正。哈尔滨黑龙江省科学技术馆的提示文本不会被解析成高度。

当前没有可靠坐标写入派生层。曾按单线程、约 1.2 秒间隔尝试少量公开 Nominatim 查询，浏览器访问可用但候选结果未同时满足影院类型、名称特征和城市匹配；失败记录见 [`data/derived/geocode-cache.json`](data/derived/geocode-cache.json)。因此 901 条暂列 `geocode-pending`，不伪造坐标。若继续补坐标，应沿用缓存、限速和名称+城市双重匹配规则，并遵守 [Nominatim 使用政策](https://operations.osmfoundation.org/policies/nominatim/)。

数据边界：原始事实是源表显示文本、来源、行号和原始字段；投影标准化、城市前缀、状态、银幕单值解析和 `id` 是规则派生；多值尺寸、无法识别投影、状态不明、名称历史歧义和未定位记录必须人工核验。`review-needed.json` 的原因计数是可重叠的，不应相加为记录总数。

### 合并前的 raw 快照处理

当前 Draft PR 的历史包含内部审计用 `data/raw/arvin-imax.json`。在最终合并到公开 `main` 前，不应直接合并当前 raw-bearing 分支；应由仓库维护者从干净的 `main` 创建发布分支，只挑选派生层、审计摘要、脚本和网页提交，或在明确备份与审批后做历史重写，并确认公开历史不再包含完整 raw 镜像。此阶段不删除本地 raw，也不自动合并 PR。

## 技术栈

- Leaflet.js
- OpenStreetMap
- 静态 HTML + JSON
- GitHub Pages

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

1. 人工检查 `data/derived/review-needed.json`，尤其是多值尺寸、状态和未识别投影
2. 采用合规且可切换的坐标来源补齐可靠地址和经纬度
3. 在人工复核后再决定是否把任何派生字段导入既有业务数据
4. 增加 1.43、1.90、15/70 等字段前先确认源表是否有明确证据
