# china-imax-map 公开分支状态

更新日期：2026-08-25
分支：`codex/public-release`
发布动作：公开候选已完成；尚未 merge、deploy

## 一句话状态

公开运行包已把 901 条静态事实与运行时 marker 分离：静态层 0 坐标，当前公开审计为 901 accepted、901 markers、0 unresolved/unlocated。公开测试为 15/15。

## 已完成

- `index.html` 已移除不存在的 `#locationFilters` 控件；`app.mjs` 对该可选控件使用空值保护，源码与 `dist-public` 已同步。
- `package.json` 只保留公开构建、验证、服务和测试脚本，不再引用未随公开分支提供的脚本。
- `scripts/public-data.test.mjs` 只读取公开静态层与公开审计，不依赖排除的本地审核数据。
- 公开文档已改为只描述公开数据流、运行时坐标边界、来源署名和本地生产前检查。
- `data/public/cinemas.json` 保留 901 条可搜索记录；屏幕与座位原文字段跨层 3,604/3,604 一致。

## 证据与检查

```powershell
npm test                 # 15 pass / 0 fail
npm run check            # public-boundary-check-passed
npm run validate:public  # 901 records, 0 static coordinates, 901 markers
```

机器可读报告：[`data/audit/public-amap-quality.json`](data/audit/public-amap-quality.json)、[`data/audit/public-release-readiness.json`](data/audit/public-release-readiness.json)、[`data/audit/public-boundary.json`](data/audit/public-boundary.json)。

## 公开边界

- 静态网页数据不含 provider 坐标、raw 候选、provider cache 或安全密钥。
- marker 只由 `/api/public/markers` 返回最小 GCJ-02 字段，使用 `sourceRow`/`id` 关联。
- 原始数据、审核工作层和运行时 marker 源不作为公开静态文件提供。
- 真实高德 SDK/代理 smoke 需要本机运行配置；本地测试通过不等于已完成生产合规或部署。

## 公开入口

- [`README.md`](README.md)：快速开始与公开数据流。
- [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)：目录边界。
- [`docs/DATA_PIPELINE.md`](docs/DATA_PIPELINE.md)：构建与验证。
- [`docs/MAP_FRONTEND.md`](docs/MAP_FRONTEND.md)：前端与 API 契约。
- [`docs/DATA-LICENSING.md`](docs/DATA-LICENSING.md)：来源和运行时许可边界。
