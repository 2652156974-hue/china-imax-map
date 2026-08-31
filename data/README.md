# 数据目录

本目录包含同一份影院资料在不同处理阶段的表示。各层不可互相替代。

| 目录 | 内容 | 是否允许网页直接读取 |
| --- | --- | --- |
| `raw/` | `BB08J2 / IMAX中国` 的原始迁移审计快照 | 否 |
| `derived/` | 901 条规则派生记录、schema 和待核清单 | 否 |
| `public/` | 经过发布边界构建的 901 条静态事实 | 是，公开网页唯一静态入口 |
| `audit/` | 完整性、词汇、状态、坐标、质量和发布审计 | 否 |
| `geocode/` | 行政区映射、reviewed override；其 `provider-cache/` 为私有缓存 | 否 |
| `local/` | 本机坐标预览、公开 AMap marker 层、Luna 审核包和临时运行文件 | 否，gitignored |

## 不变量

- `raw/arvin-imax.json` 不清洗、不覆盖、不删除。
- 派生失败或证据不足时使用 `null`、`unknown` 或 review reason，不猜测。
- `public/cinemas.json` 只能由公开数据构建器生成。
- 公开地图的 accepted AMap GCJ-02 点只由 server-side marker layer 在运行时返回；数量以 `data/audit/public-amap-quality.json` 为准，不得生成静态坐标批量文件。
- `derived/screen-seat-columns.csv` 是从原始快照按源表列顺序导出的银幕宽度、银幕高度、银幕面积和座位数明细。
- provider cache、local preview、Luna 审核包和私有高德坐标不得进入公开 Git 历史。
- “901 条源数据完整”不等于“901 个 POI 坐标已核验”。

## 当前计数

- 原始数据行：901
- 派生记录：901
- 公开静态记录：901，静态坐标 0，运行时 marker 数量以公开审计为准
- 私人运行记录：901，已定位/待核/未定位数量以 `data/audit/private-release-quality.json` 为准
- 银幕/座位展示字段：4,505 个源表显示值；其中 3,604 个宽度、高度、面积、座位原文字段跨层一致

运行 `npm run check` 可刷新项目清单和边界检查。
