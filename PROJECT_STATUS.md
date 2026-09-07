# china-imax-map 项目状态

更新日期：2026-09-01
工作分支：`develop/current`
公开基线：`fba4dcd` → `codex/public-release`（公开发布基线）
线上部署：Cloudflare Worker `china-imax-map` 现由 GitHub Actions 自动发布；生产触发分支为 `develop/current`。本次自动发布配置已完成本地验证，但尚未由本地分支提交、推送或用新配置重新部署线上版本。
发布状态：`publicationReady=true`；本次同步不合并 `main`，不重写公共发布历史

## 一句话状态

`BB08J2 / IMAX中国` 的 901 条源数据已经完成全量迁移审计和派生；公开版已切换为 AMap JS API 2.0 website/H5 runtime。当前验收为 901/901 accepted、901 markers、0 unresolved、0 unlocated，其中身份精确 801、场所级定位 100；901 条都继续保留在列表和详情中。

## 已完成

- 腾讯文档目标工作表核验为 `903 × 8`，其中 901 条数据行逐行、逐列一致。
- `data/raw/arvin-imax.json` 保留经过审计的原始快照，没有被清洗或覆盖。
- 901 条记录全部生成派生层，901 条均安全识别城市；区域分布为大陆 881、香港 7、澳门 1、台湾 12。
- 投影、营业状态、影院名称历史、银幕尺寸安全解析和质量审计均有可重复脚本及测试。
- 公开地图读取 `data/public/cinemas.json` 的 901 条静态事实，并从 `/api/public/markers` 动态获取 901 个最小 GCJ-02 marker；静态目录不含坐标批量文件。
- 私人高德地图运行层使用本机忽略文件和环境变量；公开/私人两版真实浏览器 smoke 均通过，且不把安全密钥、provider cache 或 raw candidates 写入发布数据。
- 901 条公开、私人和 Luna 记录均携带银幕宽度、高度、面积和座位原文；3,604 个原文字段跨层一致。正常单值按格式化数字显示，暂无数据不显示 raw，多值/异常原文只在折叠「数据说明」中显示。

## 自动发布状态

- GitHub Actions 工作流为 [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml)，仅 `develop/current` 的 push 或从 `develop/current` 手动触发会进入部署 job；Pull Request 只验证，不上线。
- Cloudflare KV namespace 已建立，`public-amap-markers` 已写入并复核 901 条最小 GCJ-02 marker；静态 `dist-public/` 仍保持 0 坐标。
- GitHub 仓库还需一次性配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 两个 Actions secret。此后正常流程是提交并 push `develop/current`，由 Actions 自动完成校验、构建和 Worker 部署。

## 坐标状态

| 分类 | 数量 | 当前处理方式 |
| --- | ---: | --- |
| 已定位/公开 runtime marker | 901 | 当前 canonical layer 接受；markerCount 与 accepted 相等 |
| 场所级定位 | 100 | 已 accepted，不是 pending review |
| 待核 | 0 | 当前三态分区中 pending-review=0 |
| 未解决 | 0 | 当前 canonical layer 无 unresolved |
| 未定位合计 | 0 | accepted + unlocated = 901 |
| 合计 | 901 | 901 markers；公开静态 0 坐标，运行时 901 marker |

这里的“原始文件已核验”只表示腾讯表格迁移内容完整，不代表第三方地图返回的每一个 POI 身份和坐标已经人工核验。

## 待处理

1. 历史 323-row Luna review snapshot 已明确标为 `historical-non-blocking`；其 `needsMoreEvidence/reviewComplete:false` 不参与当前 release gate。
2. 公开/私人 JS API 2.0 真实浏览器 smoke 已通过；环境凭据未写入源码、审计 JSON 或发布包。
3. 已从 clean baseline `fba4dcd` 建立 `codex/public-release`，公开 manifest 明确排除 raw、provider cache、data-local、私有包和完整坐标导出。
4. 本次同步目标是 `develop/current`；公开静态事实层保持无坐标，GCJ-02 marker 与行政绑定通过 Cloudflare KV 运行时层提供，不将 `data/local/` 或 provider cache 纳入公开 Git 历史。

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
