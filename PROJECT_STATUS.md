# china-imax-map 公开分支状态

更新日期：2026-08-26
分支：`codex/public-release`
发布动作：Cloudflare Worker 已上线；live URL：`https://china-imax-map.2652156974.workers.dev`
本次发布：公开分支提交 `213d3fa`；Worker version `37fae793-3783-4d17-8db7-349d19f38508`

## 一句话状态

公开运行包已把 901 条静态事实与运行时 marker 分离：静态层 0 坐标；Cloudflare Worker 从部署时生成的最小 marker 模块读取运行数据，公开静态构建不读取私有 marker。当前公开审计为 901 accepted、901 markers、0 unresolved/unlocated；页面包含附近搜索与行政区显示，线上 root/runtime-config/marker 验收通过。

## 已完成

- `index.html` 已移除不存在的 `#locationFilters` 控件；`app.mjs` 对该可选控件使用空值保护，源码与 `dist-public` 已同步。
- `package.json` 只保留公开构建、验证、服务和测试脚本，不再引用未随公开分支提供的脚本。
- `scripts/public-data.test.mjs` 只读取公开静态层与公开审计，不依赖排除的本地审核数据。
- 公开文档已改为只描述公开数据流、运行时坐标边界、来源署名和本地生产前检查。
- `data/public/cinemas.json` 保留 901 条可搜索记录；屏幕与座位原文字段跨层 3,604/3,604 一致。
- `wrangler.jsonc` 固定 Worker 名称 `china-imax-map`、`nodejs_compat` 和必需的两项 Cloudflare secrets。
- `worker/index.mjs` 只使用 Worker Web API；静态资源由 `ASSETS` 提供，marker 仅从部署 bundle 内的最小模块读取，高德代理仅允许 `restapi.amap.com` 与 `webapi.amap.com`。
- `scripts/prepare-public-deploy.mjs` 生成被忽略的最小 marker JSON/ES module、临时 Worker 入口及 SHA-256；`scripts/build-cloudflare-public.mjs` 只复制公开静态文件。

## 证据与检查

```powershell
npm test                 # 51 pass / 0 fail
npm run check            # public-boundary-check-passed
npm run validate:public  # 901 records, 0 static coordinates, 901 markers
npm run cloudflare:check # 354.84 KiB upload / gzip 28.84 KiB; marker bundle entry passed
```

机器可读报告：[`data/audit/public-amap-quality.json`](data/audit/public-amap-quality.json)、[`data/audit/public-release-readiness.json`](data/audit/public-release-readiness.json)、[`data/audit/public-boundary.json`](data/audit/public-boundary.json)。

## 公开边界

- 静态网页数据不含 provider 坐标、raw 候选、provider cache 或安全密钥。
- marker 只由 `/api/public/markers` 返回最小 GCJ-02 字段，使用 `sourceRow`/`id` 关联。
- 原始数据、审核工作层和运行时 marker 源不作为公开静态文件提供。
- 真实高德 SDK/代理 smoke 需要本机运行配置；本地测试和 Wrangler dry-run 不等于线上合规或部署，线上 gate 还包括 Cloudflare 认证、marker bundle SHA 核对、高德域名白名单和 live URL 验证。
- Wrangler OAuth 已认证并安全设置两项 secrets；线上 root 与 runtime-config 均返回 200，marker 接口返回 901 条唯一 sourceRow（2–902），未发现 raw/ranked/provider-cache 或 secret 字段。按安全边界未调用 AMap proxy；生产域名白名单仍需单独确认。

## 公开入口

- [`README.md`](README.md)：快速开始与公开数据流。
- [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)：目录边界。
- [`docs/DATA_PIPELINE.md`](docs/DATA_PIPELINE.md)：构建与验证。
- [`docs/MAP_FRONTEND.md`](docs/MAP_FRONTEND.md)：前端与 API 契约。
- [`docs/DATA-LICENSING.md`](docs/DATA-LICENSING.md)：来源和运行时许可边界。
