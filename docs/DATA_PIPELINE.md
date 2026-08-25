# 公开数据管线

公开分支的输入粒度是一条腾讯表格行对应一条影院/IMAX 记录。公开输出只保留可展示的事实字段和来源信息；坐标由运行时 marker 服务提供。

## 公开层

1. `data/derived/cinemas.json`：901 条规则派生记录。
2. `data/public/cinemas.json`：公开静态事实层；不含坐标、provider 候选或凭据。
3. `data/audit/`：公开质量、边界和发布审计摘要。
4. 本机运行时 marker 层：由公开 server 读取，静态目录不提供批量坐标文件。

公开分支不携带原始快照、provider cache 或完整候选响应。运行时 marker 源需要从受控的本地环境注入，不能把它误当成公开静态数据。

## 构建与验证

```powershell
npm run build:public
npm run validate:public
npm run check
npm test
```

`build:public` 先生成运行时 marker 层，再生成 `data/public/cinemas.json` 和 `dist-public/`。如果本机没有受控 marker 源，构建应失败，不以空数据或猜测坐标替代。`validate:public` 检查 901 条记录、连续 `sourceRow`、静态坐标为零、原文字段一致和 marker 层分区；`check` 检查公开路径、凭据和发布边界。

## 字段原则

- 来源原文优先；`name`、投影、状态和屏幕/座位字段保持可追溯。
- 多值、异常或无法安全解析的数值不强行选择；页面显示待核，原文留在允许的说明字段中。
- `providerLat/providerLng` 只存在于运行时 marker 响应，保持 GCJ-02。
- 场馆或商场位置不能自动升级为精确影院身份。
- 静态事实层与运行时 marker 层按 `sourceRow`/`id` 连接。

前端契约见 [`MAP_FRONTEND.md`](MAP_FRONTEND.md)，来源和高德运行时边界见 [`DATA-LICENSING.md`](DATA-LICENSING.md)。
