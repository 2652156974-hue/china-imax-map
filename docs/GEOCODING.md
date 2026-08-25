# Geocoding and coordinate provenance

## Mainland AMap pipeline

The mainland matcher is frozen at the audit SHA recorded in `data/audit/geocode-mainland-freeze.json`. It uses POI search, not city-center geocoding, and scores current name, former name, project, brand, POI type, administrative compatibility and auditorium-format compatibility.

The current operational quota guard is cache-first and caps new AMap requests at 600 for a run (`AMAP_MAX_NEW_REQUESTS`, hard-capped by the runner at 600). Successful cache entries are not refreshed. A mainland full rerun is not part of the current acceptance run; Hong Kong, Macau and Taiwan are separate provider scopes and do not consume this mainland budget.

Administrative compatibility uses province, prefecture and county-level division fields. A county-level city is accepted only when the provider province, parent prefecture and `adname` agree with the auditable mapping layer.

## Hong Kong, Macau and Taiwan scope

Hong Kong, Macau and Taiwan are not sent through the mainland AMap budget. They have a separate regional adapter at `scripts/geocode/providers/nominatim.mjs` and a cache-first audit runner:

```text
node scripts/geocode-regional.mjs --scope=regional --provider=nominatim --network --max-new=20
```

The runner uses only normal public Nominatim search, identifies the application with a User-Agent, keeps at least one second between new requests, stores raw provider responses only in the ignored private cache, and writes compact selected/reject summaries to `data/audit/geocode-hkmo-tw.json`. Nominatim returns WGS84, so no GCJ-02 conversion is applied. A failed or unresolved regional result remains null; no city-centre fallback is allowed. This is a separate provider audit, not a claim that the whole Tencent document has been geocoded.

## Confidence dimensions

- `identityConfidence`: confidence that the selected POI is the cinema/auditorium identity.
- `locationConfidence`: confidence that the coordinate represents the physical cinema, venue or mall.
- `locationGranularity`: `auditorium`, `cinema`, `venue` or `mall`.
- `positionType`: `cinema-poi`, `venue-poi` or `mall-fallback`.

An approved location-only venue remains identity-medium or lower. It must not be shown as an exact cinema identity.

## CRS

AMap coordinates are stored as `providerLat/providerLng` with `providerCrs=GCJ-02` and are drawn directly by both AMap JS API 2.0 frontends. The local preview and independent OSM/Nominatim audits may carry separate WGS84 fields, but those fields never replace the AMap provider coordinates or enter the public AMap runtime layer.

## Public boundary

The public site uses official website/H5 AMap functionality rather than publishing an independent coordinate database: static `data/public/cinemas.json` has no coordinates, while the server-side `/api/public/markers` response supplies the current accepted GCJ-02 points at runtime. The current audit snapshot is accepted/markerCount=607 with 294 unlocated records; all 901 records remain in the list and detail view. See [DATA-LICENSING.md](DATA-LICENSING.md) and [MAP_FRONTEND.md](MAP_FRONTEND.md).
