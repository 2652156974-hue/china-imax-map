# 公开分支目录与发布边界

```text
china-imax-map/
├─ index.html / app.mjs / styles.css   公开网页源码
├─ data/
│  ├─ derived/                         规则派生输入
│  ├─ public/                          公开静态事实层
│  └─ audit/                           公开质量与边界摘要
├─ scripts/                            公开构建、服务和测试脚本
├─ docs/                               公开文档
├─ dist-public/                        本机生成的公开运行包
├─ package.json                        公开命令入口
└─ README.md / PROJECT_STATUS.md       状态与导航
```

## 可见性

| 路径 | 用途 | 公开规则 |
| --- | --- | --- |
| `data/derived/` | 901 条规则派生记录 | 作为公开构建输入，不放 provider 候选 |
| `data/public/` | 网页静态事实 | 901 条记录，静态坐标为零 |
| `data/audit/` | 公开质量、边界和发布摘要 | 不复制完整候选响应或凭据 |
| `scripts/` | 构建、服务、验证和回归测试 | 只保留公开分支可运行入口 |
| `dist-public/` | 本机生成的网页输出 | 本机产物，不是坐标批量下载目录 |
| 运行时 marker 源 | server 读取的最小 GCJ-02 层 | 受控本地输入，不进入公开静态目录 |

## 公开数据流

```text
data/derived/cinemas.json
        ↓ npm run build:public
data/public/cinemas.json (901 条静态事实，无坐标)
        ↓ /api/public/markers
AMap JS API 2.0 (运行时 GCJ-02 marker)
```

公开输出不包含 raw 镜像、provider cache、完整候选、坐标 CSV/GeoJSON、Web Service Key 或安全密钥。所有 marker 按 `sourceRow`/`id` 关联。

## 发布前检查

```powershell
npm test
npm run check
npm run validate:public
```

这些检查覆盖静态字段、连续行号、坐标边界、凭据扫描、忽略规则和运行时 marker 分区。push、merge、PR、deploy 以及高德控制台合规检查均是独立的后续授权事项。
