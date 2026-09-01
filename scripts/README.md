# 脚本与命令

需要 Node.js 20 以上版本。优先从项目根目录运行 `npm` 命令。

## 日常验证

```powershell
npm test
npm run validate:derived
npm run validate:public
npm run check
```

`npm run check` 不发出地图 API 请求，也不应用坐标；它只检查项目结构、数据量、静态/运行时边界、Git 忽略规则和凭据泄漏，并刷新项目 manifest。

## Cloudflare 自动发布

生产分支为 `develop/current`。GitHub Actions 会在该分支 push 时自动执行测试、公开静态构建、Cloudflare KV marker 校验、Wrangler dry-run 和 Worker 部署；Pull Request 只执行验证。工作流文件为 [`../.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml)。

本地可先运行：

```powershell
npm run test:cloudflare
npm run build:cloudflare
npm run prepare:cloudflare-marker
npm run cloudflare:check
```

其中 `prepare:cloudflare-marker` 只从本机 gitignored 的 reviewed layer 生成最小 runtime marker；它不会把坐标、provider cache 或密钥写入 Git。GitHub Actions 不重新请求高德，而是校验 Cloudflare KV 中已准备好的 `public-amap-markers`，因此日常网页和代码发布只需要 push 代码。若 reviewed marker 的坐标或行政绑定发生变化，因为该私有层不进公开 Git，需要另行更新一次 KV。

首次启用前，在 GitHub 仓库 Actions secrets 中配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。AMap JS Key 与安全密钥继续存放在 Cloudflare Worker secrets 中。

## 数据构建

```powershell
npm run derive
npm run build:public
npm run build:public-layer
npm run build:preview
npm run build:luna-review
```

- `derive` 会从 raw 重新生成派生数据，只有修改解析规则后才运行。
- `build:public` 生成 901 条无静态坐标的公开事实包、按当前 accepted 数动态生成的最小 AMap runtime layer 和 `dist-public/`。
- `build:public-layer` 单独重建 gitignored 的公开 server-side marker layer。
- `build:preview` 生成 gitignored 的本机预览数据。
- `build:luna-review` 生成 gitignored 的当前未定位/待审核记录包；数量从审计输入动态推导。

## 公开高德地图

设置 `AMAP_JS_API_KEY` 与 `AMAP_JS_SECURITY_CODE` 后：

```powershell
npm run start:public
npm run stop:public
```

公开页面在线加载 AMap JS API 2.0；安全密钥只由同源 server proxy 使用。正式生产前要在高德控制台完成域名、账户/商业状态检查，并轮换此前可能外泄的安全密钥。

## 私人高德地图

不熟悉终端时，直接双击项目根目录：

- `START_PRIVATE_MAP.cmd`
- `STOP_PRIVATE_MAP.cmd`

命令行等价入口：

```powershell
npm run build:private
npm run serve:private
npm run start:private
npm run stop:private
```

真实 Key 和安全密钥只从 Windows 用户环境变量读取。不要在 `.env.example`、源码、JSON、README 或命令参数中填写密钥。

## 地理编码安全边界

- provider cache-first；不得刷新已成功 AMap 查询。
- 不使用城市中心点，不按第一候选直接命中。
- `--full` 和 `--apply` 仍不是日常操作入口。
- 任何查询批次必须遵守单独设定的 API 请求预算，并报告新请求数和 cache hit。
- 港澳台不消耗大陆 AMap 请求预算。

脚本细节见 [`../docs/DATA_PIPELINE.md`](../docs/DATA_PIPELINE.md) 和 [`../docs/GEOCODING.md`](../docs/GEOCODING.md)。
