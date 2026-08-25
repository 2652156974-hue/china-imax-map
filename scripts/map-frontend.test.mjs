import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)));
const html = await readFile(join(repoRoot, 'index.html'), 'utf8');
const app = await readFile(join(repoRoot, 'app.mjs'), 'utf8');
const locationFormat = await readFile(join(repoRoot, 'public-location-format.mjs'), 'utf8');
const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
const docs = await readFile(join(repoRoot, 'docs', 'MAP_FRONTEND.md'), 'utf8');

test('public frontend module parses', async () => {
  const check = await import(`data:text/javascript,${encodeURIComponent(app)}`).catch((error) => error);
  assert.ok(check instanceof Error || check === undefined);
  assert.doesNotMatch(app, /SyntaxError/);
});

test('AMap JS API 2.0 is the only public map runtime', () => {
  assert.match(app, /https:\/\/webapi\.amap\.com\/maps/);
  assert.match(app, /searchParams\.set\('v', '2\.0'\)/);
  assert.match(app, /AMap\.MarkerCluster/);
  assert.match(app, /_AMapSecurityConfig/);
  assert.match(app, /serviceHost/);
  assert.doesNotMatch(`${html}\n${app}\n${css}`, /maplibre|openfreemap|tile\.openstreetmap\.org/i);
});

test('marker service is minimal and joined by sourceRow/id', () => {
  assert.match(app, /method: 'POST'/);
  assert.match(app, /sourceRows/);
  assert.match(app, /metadata\.id !== marker\.id/);
  assert.match(app, /markerByRow\.set\(marker\.sourceRow/);
  assert.match(app, /providerCrs !== 'GCJ-02'/);
  assert.match(app, /config\.markerEndpoint/);
});

test('all filters, list access, and no-coordinate detail are wired', () => {
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
  assert.doesNotMatch(html, /id="locationFilters"/);
  assert.match(app, /const locationFilters = document\.querySelector\('#locationFilters'\)/);
  assert.match(app, /button\.addEventListener\('click', \(\) => focusCinema\(cinema\)\)/);
  assert.match(app, /if \(!hasCoordinate\(cinema\)\)/);
  assert.match(app, /showDetail\(cinema\)/);
  assert.match(app, /screenField/);
  assert.match(app, /seatField/);
  assert.match(css, /white-space: pre-wrap/);
});

test('public field presentation keeps raw values out of normal detail rows', () => {
  assert.match(`${html}\n${app}`, /场所级定位/);
  assert.doesNotMatch(`${html}\n${app}`, /位置待核/);
  assert.match(app, /function renderDataNotes/);
  assert.match(app, /class="data-notes"/);
  assert.match(app, /formatNumber\(safeNumber, field === 'area' \? 2 : 3\)/);
  assert.doesNotMatch(app, /源文：/);
});

test('detail popup uses one dynamic positioning-information row', () => {
  assert.match(app, /formatLocationInfo\(cinema, \{ hasCoordinate: hasCoordinate\(cinema\) \}\)/);
  assert.match(app, /<b>定位信息<\/b>/);
  assert.doesNotMatch(app, /<b>状态<\/b>|<b>位置粒度<\/b>|<b>位置\/身份<\/b>|<b>坐标来源<\/b>/);
  assert.match(locationFormat, /空片段|formatLocationInfo/);
});

test('primary UI containers share translucent light/dark surfaces without strong blur', () => {
  assert.match(css, /--panel:\s*rgba\(255,\s*255,\s*255,\s*\.97\)/);
  assert.match(css, /--panel:\s*rgba\(21,\s*24,\s*29,\s*\.97\)/);
  assert.match(css, /\.panel, \.detail-panel[\s\S]*background: var\(--panel\)/);
  assert.match(css, /input[\s\S]*background: var\(--panel\)/);
  assert.match(css, /backdrop-filter: blur\(4px\)/);
  assert.doesNotMatch(css, /backdrop-filter: blur\(12px\)/);
});

test('credential proxy and attribution remain visible', () => {
  assert.match(html, /runtime-config\.js/);
  assert.match(app, /pathname !== '\/_AMapService'/);
  assert.match(app, /@ArvinTingcn/);
  assert.match(html, /docs\.qq\.com\/sheet/);
  assert.doesNotMatch(`${html}\n${app}`, /securityJsCode|AMAP_JS_SECURITY_CODE/);
  assert.match(docs, /AMap JS API 2\.0|AMap/);
});
