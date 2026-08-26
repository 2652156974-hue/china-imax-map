import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)));
const html = await readFile(join(repoRoot, 'index.html'), 'utf8');
const app = await readFile(join(repoRoot, 'app.mjs'), 'utf8');
const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
const sdkMock = await readFile(join(repoRoot, 'scripts', 'fixtures', 'amap-js-sdk.mock.js'), 'utf8');
const docs = await readFile(join(repoRoot, 'docs', 'MAP_FRONTEND.md'), 'utf8');

test('public frontend module parses', async () => {
  const check = await import(`data:text/javascript,${encodeURIComponent(app)}`).catch((error) => error);
  assert.ok(check instanceof Error || check === undefined);
  assert.doesNotMatch(app, /SyntaxError/);
});

test('AMap JS API 2.0 is the only public map runtime', () => {
  assert.match(app, /https:\/\/webapi\.amap\.com\/maps/);
  assert.match(app, /searchParams\.set\('v', '2\.0'\)/);
  assert.match(app, /buildAdministrativeDisplay/);
  assert.match(app, /resolveAdminCollisions/);
  assert.match(app, /zoomend/);
  assert.match(app, /_AMapSecurityConfig/);
  assert.match(app, /serviceHost/);
  assert.doesNotMatch(app, /AMap\.MarkerCluster|averageCenter|DistrictSearch|Geocoder|PlaceSearch/);
  assert.doesNotMatch(`${html}\n${app}\n${css}`, /maplibre|openfreemap|tile\.openstreetmap\.org/i);
});

test('administrative display keeps one zoom layer and explicit marker accessibility', () => {
  for (const source of [app]) {
    assert.match(source, /buildAdministrativeDisplay\(/);
    assert.match(source, /resolveAdminCollisions\(/);
    assert.match(source, /const collisionItems = items\.filter\(\(item\) => item\.kind === 'administrative' \|\| item\.kind === 'same-site'\)/);
    assert.match(source, /withZeroDisplayOffset\(item\)/);
    assert.match(source, /if \(isSameSite\) \{\s*state\.map\.setZoomAndCenter\(17, item\.lnglat/s);
    assert.match(source, /同址 \$\{count\} 家 IMAX/s);
    assert.match(source, /lngLatToContainer/);
    assert.match(source, /maxOffsetPx:\s*32/);
    assert.match(source, /admin-cluster/);
    assert.match(source, /admin-cluster__name/);
    assert.match(source, /admin-cluster__count/);
    assert.match(source, /aria-label=/);
    assert.match(source, /title=/);
    assert.match(source, /displayMode/);
    assert.match(source, /renderedItems/);
    assert.match(source, /adminAggregateCount/);
    assert.match(source, /visibleMarkers/);
    assert.match(source, /const size = isCinema \? 16 : displayItemSize\(item\)/);
    assert.match(source, /compact \? Math\.max\(28, size - 6\) : size/);
  }
  for (const source of [css]) {
    assert.match(source, /count-size--s\.admin-cluster--compact \{ --admin-cluster-size: 28px; \}/);
    assert.match(source, /count-size--xl\.admin-cluster--compact \{ --admin-cluster-size: 48px; \}/);
  }
  assert.match(css, /\.panel, \.detail-panel \{\s*position: absolute;\s*z-index: 120;/s);
  assert.match(css, /\.detail-panel \{\s*z-index: 125;/s);
  for (const source of [app]) {
    assert.match(source, /item\.level === 'province' \? 6/);
    assert.match(source, /item\.level === 'prefecture' \? 8/);
    assert.match(source, /const targetZoom = Math\.max\(baseTargetZoom, Math\.floor\(currentZoom\) \+ 1\)/);
  }
});

test('administrative binding stays on the public record, not only inside location', () => {
  assert.match(app, /return marker \? \{\s*\.\.\.record,\s*administrative: normalizeAdministrativeBinding\(marker\.administrative \?\? record\.administrative \?\? null\),\s*location:/s);
  assert.doesNotMatch(app, /reviewVerdict: marker\.reviewVerdict,\s*administrative:/s);
  assert.match(app, /function normalizeAdministrativeBinding\(value\)/);
});

test('frontend runtime and SDK mock do not retain legacy spatial cluster/query APIs', () => {
  assert.doesNotMatch(`${app}\n${sdkMock}`, /AMap\.MarkerCluster|averageCenter|DistrictSearch|Geocoder|PlaceSearch/);
  assert.match(sdkMock, /lngLatToContainer/);
  assert.match(sdkMock, /emit\(event/);
  assert.match(sdkMock, /setOffset\(offset\)/);
});

test('marker service is minimal and joined by sourceRow/id', () => {
  assert.match(app, /method: 'POST'/);
  assert.match(app, /sourceRows/);
  assert.match(app, /metadata\.id !== marker\.id/);
  assert.match(app, /markerByRow\.set\(marker\.sourceRow/);
  assert.match(app, /providerCrs !== 'GCJ-02'/);
  assert.match(app, /config\.markerEndpoint/);
});

test('system filters, nearby controls, list access, and no-coordinate detail are wired', () => {
  for (const token of [
    'data-system="GT Laser"',
    'data-system="Commercial Laser"',
    'data-system="Laser XT"',
    'data-system="Xenon"',
    'data-dome="true"',
    'data-region="香港"',
    'data-region="澳门"',
    'data-region="台湾"',
    'data-audio="12"'
  ]) assert.ok(html.includes(token), `missing UI token: ${token}`);
  for (const token of ['id="nearbyButton"', '我的位置', 'data-nearby-sort="distance"', 'data-nearby-sort="screen"', 'data-nearby-sort="spec"', 'id="exitNearbyButton"']) {
    assert.ok(html.includes(token), `missing nearby UI token: ${token}`);
  }
  assert.doesNotMatch(`${html}\n${app}`, /locationFilters|data-location|位置核验筛选/);
  assert.match(app, /button\.addEventListener\('click', \(\) => focusCinema\(cinema\)\)/);
  assert.match(app, /if \(!hasCoordinate\(cinema\)\)/);
  assert.match(app, /showDetail\(cinema\)/);
  assert.match(app, /screenField/);
  assert.match(app, /seatField/);
  assert.match(css, /white-space: pre-wrap/);
});

test('public field presentation keeps raw values out of normal detail rows', () => {
  assert.match(app, /场所级定位/);
  assert.doesNotMatch(`${html}\n${app}`, /位置待核/);
  assert.match(app, /function renderDataNotes/);
  assert.match(app, /class="data-notes"/);
  assert.match(app, /reliableScreenField\(screen, field\)/);
  assert.match(app, /暂无数据/);
  assert.doesNotMatch(app, /源文：/);
});

test('nearby mode is user initiated and does not issue cinema POI queries', () => {
  assert.match(app, /AMap\.Geolocation/);
  assert.match(app, /getCurrentPosition/);
  assert.match(app, /showMarker: false/);
  assert.match(app, /buildNearbyCandidateSet/);
  assert.match(app, /sortNearbyCandidates/);
  assert.doesNotMatch(app, /AMap\.PlaceSearch|AMap\.Geocoder|AMap\.DistrictSearch/);
  assert.doesNotMatch(`${html}\n${app}`, /navigator\.geolocation/);
});

test('credential proxy and attribution remain visible', () => {
  assert.match(html, /runtime-config\.js/);
  assert.match(app, /pathname !== '\/_AMapService'/);
  assert.match(app, /@ArvinTingcn/);
  assert.match(html, /docs\.qq\.com\/sheet/);
  assert.doesNotMatch(`${html}\n${app}`, /securityJsCode|AMAP_JS_SECURITY_CODE/);
  assert.match(docs, /AMap JS API 2\.0|AMap/);
});
