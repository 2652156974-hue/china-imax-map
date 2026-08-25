# 数据来源与公开运行时边界

本文记录工程上的来源署名和发布边界，不构成法律意见。

## 来源与署名

影院规格来源为 @ArvinTingcn 维护的《全球 IMAX 及特效影厅分布》腾讯文档：

- [腾讯文档 BB08J2 / IMAX中国](https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2)
- [@ArvinTingcn 微博](https://weibo.com/6729835778)

网页和公开数据保留来源署名。IMAX 名称及相关商标归其权利人所有；本项目不代表 IMAX Corporation 或任何影院。

## 高德 JS API 2.0

公开网页使用官方 AMap JS API 2.0：

- [高德地图开放平台服务协议](https://lbs.amap.com/pages/terms/)
- [JS API 2.0 准备](https://lbs.amap.com/api/javascript-api-v2/prerequisites)
- [JS API 安全密钥方案](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)

公开实现遵循运行时边界：

- `data/public/cinemas.json` 含 901 条静态事实，不含坐标。
- `/api/public/markers` 只返回 live map 所需的最小 GCJ-02 marker 字段。
- 浏览器只接收 Web 端 JS Key；安全密钥仅由同源服务端代理使用。
- provider cache、完整候选响应、原始镜像、坐标 CSV/GeoJSON 和凭据不属于公开输出。

高德坐标保持 `providerCrs=GCJ-02` 并直接绘制，不转换为 WGS84，也不生成城市中心点。上线前需在高德控制台确认域名白名单、账户/商业状态和安全密钥轮换；本地构建和测试不等于生产授权或部署。
