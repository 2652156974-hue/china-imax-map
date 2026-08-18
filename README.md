# China IMAX Map

中国 IMAX 影院交互地图原型。

## 当前状态

- v0.1：地图、设备类型筛选、搜索、影院详情弹窗
- 当前 `data/cinemas.json` 仅为演示数据，不代表真实影院规格
- 正式数据源与授权确认后再导入完整影院数据库

## 技术栈

- Leaflet.js
- CARTO / OpenStreetMap 底图
- 静态 HTML + JSON
- 计划使用 GitHub Pages 部署

## 数据字段

`name, city, province, lat, lng, system, screenWidth, screenHeight, channels, ratio, film1570, status, note`

## 下一步

1. 确认影院数据授权
2. 导入真实 GT / CoLa / XT / Xenon 数据
3. 增加 1.43、12 声道、15/70 等高级筛选
4. 增加点位聚合和城市视图
5. 优化移动端与视觉设计
