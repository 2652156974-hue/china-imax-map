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
- `npm test` 目标为 15/15；`npm run check` 和 `npm run validate:public` 是公开边界的发布前检查。

详细机器可读证据见 [`data/audit/public-amap-quality.json`](data/audit/public-amap-quality.json)、[`data/audit/public-release-readiness.json`](data/audit/public-release-readiness.json) 和 [`data/audit/public-boundary.json`](data/audit/public-boundary.json)。当前仓库只保留本地公开分支，不执行 push、merge 或 deploy。

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

运行时 marker 源和 `dist-public/` 是本地生成物，不是公开静态下载入口。生产上线前仍需在高德控制台完成域名白名单、账户/商业状态和安全密钥轮换检查；本地测试不等于生产部署。

## Render 部署

使用单个 Node Web Service，连接 `codex/public-release` 分支：

- Build Command：`npm install`
- Start Command：`npm start`
- Health Check Path：`/`
- 环境变量：`AMAP_JS_API_KEY`、`AMAP_JS_SECURITY_CODE`
- 环境变量 `PUBLIC_AMAP_REVIEWED_FILE=/etc/secrets/public-amap-reviewed-geocodes.json`
- Secret File 名称：`public-amap-reviewed-geocodes.json`，内容使用本机生成并通过发布校验的最小 runtime layer

`npm start` 会在运行时校验 secret file 必须恰好包含 901 个 accepted GCJ-02 marker，然后只生成无静态坐标的 `dist-public/`。Render 提供的 `PORT` 会被自动采用，服务仅把最小 marker 响应交给前端，不把安全密钥写入浏览器配置。
