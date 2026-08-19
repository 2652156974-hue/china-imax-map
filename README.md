# 中国 IMAX 银幕地图

一个面向影迷的中国 IMAX 影院交互地图，目标是把影院位置、放映系统、银幕尺寸、画幅、声道等信息放到同一张地图上，方便筛选和比较。

## 数据来源与授权

影院规格数据计划主要使用：

- **@ArvinTingcn** 整理维护的《全球 IMAX 及特效影厅分布》
- 原始文档：https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP
- 微博：https://weibo.com/6729835778

2026-08-18，原资料维护者公开回复同意用于 IMAX 屏幕地图可视化，条件是**在明显位置展示来源**。因此网页主界面会持续保留醒目的数据来源标注。

本项目只对授权数据进行格式转换、字段规范化、筛选和地图可视化，不声明拥有原始影院数据的著作权。IMAX 名称及相关商标归其权利人所有，本项目与 IMAX Corporation 及各影院不存在隶属或商业合作关系。

## 当前状态

### v0.2

- 重做地图界面与中文排版
- 将底图切换为 OpenStreetMap 标准瓦片，避免上一版 CARTO 英文底图体验
- 在主界面显著展示 @ArvinTingcn 与原始文档来源
- 改进搜索、筛选、弹窗和移动端显示
- 覆盖目标明确包含：中国大陆、香港、澳门、台湾
- 当前 `data/cinemas.json` **仍为演示数据**，尚未导入授权文档的真实影院数据库

## 技术栈

- Leaflet.js
- OpenStreetMap
- 静态 HTML + JSON
- GitHub Pages

## 数据字段

当前字段：

`name, city, province, lat, lng, system, screenWidth, screenHeight, channels, ratio, film1570, status, note`

正式导入时建议补充：

`source, sourceUpdatedAt, verifiedAt, address, seats, openingDate, screenArea, region`

## 数据原则

1. 原始文档数据优先，页面不得把推测值伪装成实测值。
2. 银幕尺寸、设备升级、停业等会变化，需保留更新时间。
3. 不因技术实现方便而遗漏香港、澳门、台湾影院。
4. 对来源冲突的数据标注“待核”，不强行覆盖。
5. 网站代码与视觉设计可以独立演进，但原始影院数据始终保留来源署名。

## 下一步

1. 获取/导出授权腾讯文档的结构化数据
2. 清洗并建立正式 `cinemas.json`
3. 补齐经纬度与地址
4. 增加 1.43、1.90、12 声道、15/70、银幕尺寸等高级筛选
5. 增加点位聚合、城市视图和影院对比
6. 完成移动端细节和数据更新时间展示
