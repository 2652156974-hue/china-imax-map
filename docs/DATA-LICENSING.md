# Data licensing and runtime publication boundary

Status: `AMAP_JS_API_2_RUNTIME / publication-candidate`

This document records the engineering and provenance boundary. It is not legal advice.

## A. Arvin/Tencent source

The cinema specification source is the `BB08J2` / `IMAX中国` tab of the Tencent sheet maintained by `@ArvinTingcn`:

- Source document: <https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2>
- Maintainer: `@ArvinTingcn`
- Authorization provenance: the maintainer explicitly authorized use for the IMAX map visualization on 2026-08-18, subject to prominent attribution.

The UI and documentation retain the attribution and original-document link. The complete Tencent/raw mirror remains an internal migration and audit artifact; it is not a public web dataset.

## B. Official AMap website/H5 runtime

The public map uses the documented AMap JavaScript API 2.0 website runtime:

- [高德地图开放平台服务协议](https://lbs.amap.com/pages/terms/)
- [JS API 2.0 准备](https://lbs.amap.com/api/javascript-api-v2/prerequisites)
- [JS API 安全密钥方案](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)

The official material supports displaying documented AMap functionality in a website/H5. The current terms also distinguish ordinary/personal use from commercial technical service licensing and restrict directly storing, caching or reusing platform service data outside the documented service. Therefore the engineering route is valid for a website/H5 runtime, while the production account, domain whitelist, commercial status and any provider-specific compliance still need to be checked in the AMap console before a real production deployment. That operational check does not block local development, mock QA or this release candidate.

The public implementation follows the runtime boundary:

- `data/public/cinemas.json` contains all 901 static cinema facts and no coordinates.
- `data/local/public-amap-reviewed-geocodes.json` is a gitignored server-side layer with only the current accepted GCJ-02 decisions; its count is reported by `data/audit/public-amap-quality.json`.
- `POST /api/public/markers` returns only the requested minimal marker fields, joined by `sourceRow`/`id`; it never joins by cinema name.
- The browser loads the official AMap JS API 2.0 online and receives the browser key through `runtime-config.js`.
- `AMAP_JS_SECURITY_CODE` remains server-only and is attached by the same-origin `/_AMapService` proxy.
- Provider cache, complete candidates, raw provider responses, raw data and bulk coordinate CSV/GeoJSON/static JSON are not public artifacts.
- A previous security code seen in chat must be rotated before production; rotation does not block development.

## C. Coordinate semantics

AMap coordinates are used as returned: `providerLat/providerLng`, `providerCrs=GCJ-02`. They are drawn directly on the AMap JS API 2.0 basemap. The public or private frontend does not convert them to WGS84 and does not fabricate city-centre points.

The independent OSM/Nominatim audit contains two WGS84 points. They remain in a separate backup/audit layer and are not mixed with the AMap runtime layer or used as a public-release blocker.

## D. Public and private boundaries

The public release exposes the 901-record fact/list/detail layer and a runtime marker response whose count is reported by the current public audit. Records without accepted coordinates remain searchable and viewable without a marker; they become markers only after a later row-level review decision. Every record carries screen width, height, area and seat source text; blank values render as `暂无数据`, while multiline, multi-value, NBSP or abnormal values render as `待核` with the original text retained. The nearby feature is user-initiated, keeps the location in browser memory only, and does not issue cinema POI or geocoding requests.

The private release keeps its audited GCJ-02 marker bundle in gitignored `dist-private/` and exposes richer review evidence only to the private server. Neither release publishes provider cache or raw candidate responses.

Before a real public merge, create a clean public branch that excludes the current raw-bearing draft history. This is a Git-history hygiene requirement, not an AMap runtime permission gate.
