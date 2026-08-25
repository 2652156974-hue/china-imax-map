# china-imax-map 项目状态

更新日期：2026-08-24  
工作分支：`feat/tencent-sheet-import`  
基线提交：`68fb045`  
发布状态：Release candidate with gate；未 commit/push/merge/deploy

## 一句话状态

`BB08J2 / IMAX中国` 的 901 条源数据已经完成全量迁移审计和派生；公开版已切换为 AMap JS API 2.0 website/H5 runtime。当前审计快照为 659 个 GCJ-02 marker/已定位记录，其中身份精确 643、位置-only 16；242 条未定位，pending-review 为 0，901 条都继续保留在列表和详情中。

## 已完成

- 腾讯文档目标工作表核验为 `903 × 8`，其中 901 条数据行逐行、逐列一致。
- `data/raw/arvin-imax.json` 保留经过审计的原始快照，没有被清洗或覆盖。
- 901 条记录全部生成派生层，901 条均安全识别城市；区域分布为大陆 881、香港 7、澳门 1、台湾 12。
- 投影、营业状态、影院名称历史、银幕尺寸安全解析和质量审计均有可重复脚本及测试。
- 公开地图读取 `data/public/cinemas.json` 的 901 条静态事实，并从 `/api/public/markers` 按当前审计层动态获取最小 GCJ-02 marker；当前 markerCount=659，静态目录不含坐标批量文件。
- 私人高德地图运行层使用本机忽略文件和环境变量；公开/私人两版真实浏览器 smoke 均通过，且不把安全密钥、provider cache 或 raw candidates 写入发布数据。
- 901 条公开、私人和 Luna 记录均携带银幕宽度、高度、面积和座位原文；3,604 个原文字段跨层一致，4,505 个 CSV 显示值已冻结。

## 坐标状态

| 分类 | 数量 | 当前处理方式 |
| --- | ---: | --- |
| 已定位/公开 runtime marker | 659 | 当前审核层接受；markerCount 与 accepted 相等 |
| 待核 | 0 | 本轮 42 条 pending 已形成最终 verdict 并物化 |
| 未解决 | 242 | 保持 `lat=null/lng=null`，不加 marker |
| 未定位合计 | 242 | pending 0 + unresolved 242 |
| 合计 | 901 | accepted + unlocated = 901；公开静态 0 坐标，运行时 659 marker |

这里的“原始文件已核验”只表示腾讯表格迁移内容完整，不代表第三方地图返回的每一个 POI 身份和坐标已经人工核验。

## 待处理

1. 323 条 Luna review 已全部形成机器可读 verdict：67 条 exact、15 条 location-only、240 条 needs-more-evidence、1 条 reject；接受的 82 条坐标仅通过独立 reviewed layer 进入运行层。
2. 公开/私人 JS API 2.0 真实浏览器 smoke 已通过；环境凭据未写入源码、审计 JSON 或发布包。
3. 从干净的 `main` 建立 `release/v0.3-public`，选择性带入源码、派生数据和公开审计摘要；不要直接合并当前含 raw 快照历史的 feature 分支。
4. clean branch、commit/push、PR 和 deployment 尚未执行；当前唯一自动发布门是 raw-bearing history，需在明确的发布操作窗口内处理。

## 项目入口

- Luna 双版本开发 Goal：[`LUNA_DUAL_RELEASE_GOAL.md`](LUNA_DUAL_RELEASE_GOAL.md)
- 项目说明：[`README.md`](README.md)
- 目录和数据边界：[`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)
- 数据目录说明：[`data/README.md`](data/README.md)
- 脚本和命令：[`scripts/README.md`](scripts/README.md)
- 自动文件清单：[`data/audit/project-manifest.json`](data/audit/project-manifest.json)
- 自动完整性检查：[`data/audit/project-integrity.json`](data/audit/project-integrity.json)

常用命令：

```powershell
npm test
npm run check
npm run validate:derived
npm run validate:public
```

Windows 本机私有地图可双击 `START_PRIVATE_MAP.cmd`，停止服务可双击 `STOP_PRIVATE_MAP.cmd`。

## 数据性质

- 原始事实：腾讯文档中显示的文本、源行号、原始字段与来源信息。
- 规则派生：标准化投影、城市、状态、可安全解析的单值尺寸、内部 ID。
- 人工待核：POI 身份与坐标、medium/unresolved、多值银幕尺寸、复杂名称历史和无法可靠推导的状态。
