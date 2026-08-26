# 中国 IMAX 银幕地图公开运行包

这是中国 IMAX 影院公开地图的安全运行分支：静态事实层保留 901 条影院记录，地图坐标只通过服务端运行时 marker 接口交给高德地图 JS API 2.0，不把批量坐标写入公开静态数据。

## 快速开始

需要 Node.js 20 或更高版本。

```powershell
npm test
npm run check
npm run validate:public
npm run start:public
```

`start:public` 只读取本机环境中的运行配置。Web 端 JS Key 和服务端安全密钥不应写入源码、JSON、日志或 Git；停止本地服务使用 `npm run stop:public`。

## 当前验收

- `data/public/cinemas.json` 含 901 条静态事实，静态坐标数为 0。
- 运行时 marker 审计为 901 条 accepted、901 个 marker、0 条 unresolved/unlocated，坐标系为 GCJ-02。
- 3,604 个银幕/座位原文字段在派生层与公开层一致；raw 候选、provider cache 和凭据均不进入公开输出。
- `npm test` 当前为 51/51；`npm run check` 和 `npm run validate:public` 是公开边界的发布前检查。

详细机器可读证据见 [`data/audit/public-amap-quality.json`](data/audit/public-amap-quality.json)、[`data/audit/public-release-readiness.json`](data/audit/public-release-readiness.json) 和 [`data/audit/public-boundary.json`](data/audit/public-boundary.json)。公开分支使用 Cloudflare Workers Static Assets；最小 marker 只在部署时从本地忽略源打包进 Worker，不进入 Git 或静态资产。

## 数据与署名

影院规格来源为 @ArvinTingcn 维护的《全球 IMAX 及特效影厅分布》腾讯文档：

- [腾讯文档 BB08J2 / IMAX中国](https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2)
- [@ArvinTingcn 微博](https://weibo.com/6729835778)

网页保留醒目来源署名。IMAX 名称及相关商标归其权利人所有；本项目不代表 IMAX Corporation 或任何影院。

## 公开数据流

```text
data/derived/cinemas.json
        ↓ build:public
data/public/cinemas.json       901 条静态事实，无坐标
        ↓ POST /api/public/markers
AMap JS API 2.0                服务端运行时 GCJ-02 marker
```

公开 server 只按 `sourceRow`/`id` 关联 marker，不按影院名称猜配。静态页面保留全部记录的搜索、筛选和详情；没有 marker 的记录仍可查看，不补造城市中心坐标。

## 可用文件

- [`PROJECT_STATUS.md`](PROJECT_STATUS.md)：当前公开分支状态与 gate。
- [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)：公开目录和可见性边界。
- [`docs/DATA_PIPELINE.md`](docs/DATA_PIPELINE.md)：公开构建、验证和数据流。
- [`docs/MAP_FRONTEND.md`](docs/MAP_FRONTEND.md)：页面与 marker 服务契约。
- [`docs/DATA-LICENSING.md`](docs/DATA-LICENSING.md)：来源署名和高德运行时边界。
- [`data/public/cinemas.json`](data/public/cinemas.json)：公开静态事实层。
- [`scripts/build-public-release.mjs`](scripts/build-public-release.mjs)：构建公开输出。
- [`scripts/validate-public.mjs`](scripts/validate-public.mjs)：验证数据与运行时层。
- [`scripts/validate-public-boundary.mjs`](scripts/validate-public-boundary.mjs)：验证公开边界。

## Cloudflare 部署

Worker 名称固定为 `china-imax-map`，配置见 [`wrangler.jsonc`](wrangler.jsonc)。线上由一个 Worker 同时提供静态资产、运行时配置、901-marker 接口和高德代理；marker 模块只在部署 bundle 内存在，不作为静态资产或 Git 文件提供。

本地发布准备（需要本机忽略目录中的审核 marker 源）：

```powershell
npm install
npm run prepare:deploy
npm run cloudflare:check
```

`prepare:deploy` 会校验 901 条 accepted GCJ-02 marker，写入被忽略的 `tmp/cloudflare/public-amap-markers.json`、可导入的 `public-amap-markers.mjs`、临时 Worker 入口和 SHA-256；`build:cloudflare-public` 只复制公开页面、附近/行政区模块、样式、响应头和 `data/public/cinemas.json`，不会读取或复制私有 marker。临时入口只把最小 marker 模块打入 Worker bundle，不会让它成为静态文件。

```powershell
npx wrangler secret put AMAP_JS_API_KEY
npx wrangler secret put AMAP_JS_SECURITY_CODE
npm run deploy
```

两个 `secret put` 命令从交互式输入读取值；不要把值放进命令行、日志、`.env`、Git 或静态文件。Cloudflare 控制台完成高德 JS Key 域名白名单后，再用 Worker URL 验证 `/`、`/runtime-config.js`、901-row marker 请求和安全响应头；未完成白名单时不要调用高德代理健康检查。

运行时 marker 源和 `dist-public/` 是本地生成物，不是公开静态下载入口。生产上线前仍需在高德控制台完成域名白名单、账户/商业状态和安全密钥轮换检查；本地测试不等于生产部署。

`npm start` 仍可用于本地 Node server 预览；它不是线上 Cloudflare 的启动方式。Cloudflare Worker 不依赖 `node:http`、`node:fs` 或 `listen`，也不会从 Worker 环境变量读取私有 marker。

当前线上 Worker URL：[`https://china-imax-map.2652156974.workers.dev`](https://china-imax-map.2652156974.workers.dev)。首次部署到其他账号时，需先在 Cloudflare Workers onboarding 注册 `workers.dev` 子域，或在 `wrangler.jsonc` 配置一个已有 route。
