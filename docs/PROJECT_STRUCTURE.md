# 项目结构与发布边界

`china-imax-map` 采用“源码、公开输出、内部审计、私有运行数据”分层。现有文件保持原路径，避免破坏脚本引用；本页是统一导航和发布边界定义。

```text
china-imax-map/
├─ index.html / app.mjs / styles.css
│                               公开 AMap JS API 2.0 前端
├─ private-amap/              私有高德地图源码，不含 Key 和坐标数据
├─ data/
│  ├─ raw/                    腾讯表格原始审计快照
│  ├─ derived/                从 raw 规则派生的内部数据层
│  ├─ public/                 公开网页唯一数据入口
│  ├─ audit/                  完整性、规则、坐标和发布审计
│  ├─ geocode/                行政区映射、reviewed override 与私有 provider cache
│  └─ local/                  本机预览和 Luna 审核包
├─ scripts/                   构建、验证、地理编码和回归测试
├─ docs/                      项目文档与许可边界
├─ dist-public/               本机生成的公开静态运行包
├─ dist-private/              本机生成的私人高德运行包
├─ PROJECT_STATUS.md          当前状态与下一步
├─ package.json               标准命令入口
└─ README.md                  项目总说明
```

## 文件可见性

| 路径 | 用途 | Git / 发布规则 |
| --- | --- | --- |
| `data/raw/` | 经审计的原始迁移快照 | 只作内部迁移证据；最终公开 main 历史不得包含完整镜像 |
| `data/derived/` | 可重复生成的派生层 | 内部数据；保留 raw 字段和 unknown/review 状态 |
| `data/public/` | 公开网页静态事实 | 901 条唯一静态入口；坐标由运行时 marker 服务提供 |
| `data/audit/` | 质量、规则和坐标审计 | 发布前逐类审查；坐标审计不等于公开授权 |
| `data/geocode/provider-cache/` | AMap/Nominatim/Tencent 原始 provider 响应缓存 | 私有、gitignored、不得公开 |
| `data/local/` | 本机预览、Luna 审核包、公开 AMap marker 层和运行状态 | 私有、gitignored；marker 层只供公开 server 读取 |
| `private-amap/` | 私有高德地图源码 | 源码可审查，不含 Key；运行数据来自 `dist-private/` |
| `dist-private/` | 生成后的私有 GCJ-02 地图包 | 私有、gitignored、不得进入公开 Git 历史 |
| `dist-public/` | 生成后的公开 HTML/静态事实包 | 本机生成、gitignored；通过公开 server 部署，不含坐标批量文件 |
| `.env*` / `*.key` | 本机凭据 | 除空模板 `.env.example` 外全部忽略 |

## 两套地图出口

公开地图：

```text
data/derived/cinemas.json
        ↓ explicit public builder
data/public/cinemas.json (901 static facts, no coordinates)
        ↓ browser + POST /api/public/markers
AMap JS API 2.0 (runtime GCJ-02 markers; count is audit-driven)
```

私有高德地图：

```text
frozen geocode audits + local accepted layer
        ↓ private builder
dist-private/data/cinemas.json (GCJ-02)
        ↓ local credentialed server
private-amap UI
```

两条出口不互相覆盖。公开运行时 marker 层与私人地图都按 `sourceRow/id` 关联；坐标不会写入 `data/derived/cinemas.json` 或 `data/public/cinemas.json`。

## 自动清单与检查

运行：

```powershell
npm run check
```

会更新：

  - `data/audit/project-integrity.json`：必需文件、数据量、静态坐标边界、忽略规则、凭据扫描和运行时发布边界。
- `data/audit/project-manifest.json`：当前项目文件路径、大小、SHA-256、Git 状态、角色和发布类别；不复制文件内容。

临时浏览器文件 `.playwright-cli/`、`tmp/`、`node_modules/` 不属于项目清单。

## 发布前硬闸门

1. 不直接合并含 `data/raw/arvin-imax.json` 历史的 Draft PR #2。
2. 不提交 provider cache、`data/local/`、`dist-public/` 或 `dist-private/`。
3. 不把 Web 服务 Key、JS API Key 或安全密钥写入任何项目文件；安全密钥只在 server proxy 使用。
4. 不把 medium/unresolved 坐标当成已核验位置，不使用城市中心点补齐。
5. 公开构建只把 901 条事实放入静态目录；marker 坐标只能由 AMap runtime server 按 `sourceRow/id` 返回。
