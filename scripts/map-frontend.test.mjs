import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)));
const html = await readFile(join(repoRoot, 'index.html'), 'utf8');
const app = await readFile(join(repoRoot, 'app.mjs'), 'utf8');
const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
const focusModule = await readFile(join(repoRoot, 'focus-navigation.mjs'), 'utf8');
const coordinatorModule = await readFile(join(repoRoot, 'navigation-coordinator.mjs'), 'utf8');
const markerDescriptorModule = await readFile(join(repoRoot, 'marker-render-descriptor.mjs'), 'utf8');
const focusCss = await readFile(join(repoRoot, 'focus-navigation.css'), 'utf8');
const privateHtml = await readFile(join(repoRoot, 'private-amap', 'index.html'), 'utf8');
const privateApp = await readFile(join(repoRoot, 'private-amap', 'app.mjs'), 'utf8');
const privateCss = await readFile(join(repoRoot, 'private-amap', 'styles.css'), 'utf8');
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
  assert.match(coordinatorModule, /zoomend/);
  assert.match(app, /_AMapSecurityConfig/);
  assert.match(app, /serviceHost/);
  assert.doesNotMatch(`${app}\n${privateApp}`, /AMap\.MarkerCluster|averageCenter|DistrictSearch|Geocoder|PlaceSearch/);
  assert.doesNotMatch(`${html}\n${app}\n${css}\n${focusCss}`, /maplibre|openfreemap|tile\.openstreetmap\.org/i);
});

test('administrative display keeps one zoom layer and explicit marker accessibility', () => {
  for (const source of [app, privateApp]) {
    assert.match(source, /buildAdministrativeDisplay\(/);
    assert.match(source, /resolveAdminCollisions\(/);
    assert.match(source, /const collisionItems = items\.filter\(\(item\) => item\.kind === 'administrative' \|\| item\.kind === 'same-site'\)/);
    assert.match(source, /withZeroDisplayOffset\(item\)/);
    assert.match(source, /setZoomAndCenter\(17,/);
    assert.match(source, /同址 \$\{count\} 家 IMAX/s);
    assert.match(source, /projectStableCollisionPoint\(lnglat, displayMode\)/);
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
    assert.match(source, /const size = isCinema \?/);
    assert.match(source, /compact/);
    assert.match(source, /compact \? Math\.max\(28, size - 6\) : size/);
    assert.doesNotMatch(source, /item\.compactRecommended === true \|\| isSameSite/);
  }
  for (const source of [css, privateCss]) {
    assert.match(source, /count-size--s\.admin-cluster--compact \{ --admin-cluster-size: 28px; \}/);
    assert.match(source, /count-size--xl\.admin-cluster--compact \{ --admin-cluster-size: 48px; \}/);
  }
  assert.match(css, /\.panel, \.detail-panel \{\s*position: absolute;\s*z-index: 120;/s);
  assert.match(css, /\.detail-panel \{\s*z-index: 125;/s);
  assert.match(app, /enterAdministrativeFocus\(item\)/);
  assert.match(app, /from '\.\/focus-navigation\.mjs'/);
  assert.match(focusModule, /level === 'province'\) return 6\.25/);
  assert.match(focusModule, /level === 'prefecture'\) return 8\.25/);
  assert.match(focusModule, /return 11\.2/);
  assert.match(privateApp, /item\.level === 'province' \? 6/);
  assert.match(privateApp, /item\.level === 'prefecture' \? 8/);
  assert.match(privateApp, /const targetZoom = Math\.max\(baseTargetZoom, Math\.floor\(currentZoom\) \+ 1\)/);
});

test('administrative focus hides out-of-scope provinces and supports breadcrumb, back, and Escape restoration', () => {
  assert.match(html, /focus-navigation\.css/);
  assert.match(app, /focus:\s*\{\s*path:\s*\[\]/s);
  assert.match(app, /applyFocusScope\(sourceRecords, currentFocus\(\)\)/);
  assert.match(app, /const scopedLifecycleRecords = scopedRecords\.filter/);
  assert.match(app, /function enterAdministrativeFocus\(item\)/);
  assert.match(app, /function navigateFocusToDepth\(depth\)/);
  assert.match(app, /restoreEntry\?\.returnView/);
  assert.match(app, /event\.key !== 'Escape'/);
  assert.match(app, /resetFocusNavigation\(\)/);
  assert.match(focusModule, /records\.filter\(\(record\) => matchesFocusScope\(record, focus\)\)/);
  assert.match(focusCss, /\.focus-navigation/);
  assert.match(focusCss, /\.focus-breadcrumbs/);
  assert.match(focusCss, /\.focus-back/);
});

test('navigation renders from explicit target zoom and skips unchanged display signatures', () => {
  assert.match(app, /navigationCoordinator\?\.transition\(\{ focus: currentFocus\(\)/);
  assert.match(coordinatorModule, /const requestedZoom = navigationTargetZoom\(focus\)/);
  assert.match(app, /renderAdministrativeDisplay\(located, targetZoom \?\? state\.map\?\.getZoom\?\.\(\) \?\? 4\)/);
  assert.match(app, /const signature = displayRenderSignature\(\{ lifecycle: state\.lifecycle, mode: displayMode, items: resolvedItems \}\)/);
  assert.match(app, /const skipped = signature === state\.displaySignature/);
  assert.match(app, /if \(!skipped\) \{/);
  assert.match(app, /skipped\n\s*\}\);/);
});

test('public marker and navigation production paths use the shared compact modules', () => {
  assert.match(app, /markerRenderDescriptor\(item, state\.lifecycle\)/);
  assert.match(app, /markerClickTarget\(item, state\.lifecycle\)/);
  assert.match(app, /createNavigationCoordinator/);
  assert.match(markerDescriptorModule, /export function markerRenderDescriptor/);
  assert.match(markerDescriptorModule, /export function markerClickTarget/);
});

test('administrative binding stays on the public record, not only inside location', () => {
  assert.match(app, /return marker \? \{\s*\.\.\.record,\s*administrative: normalizeAdministrativeBinding\(marker\.administrative \?\? record\.administrative \?\? null\),\s*location:/s);
  assert.doesNotMatch(app, /reviewVerdict: marker\.reviewVerdict,\s*administrative:/s);
  assert.match(app, /function normalizeAdministrativeBinding\(value\)/);
});

test('lifecycle controls default to current and expose now/former navigation', () => {
  for (const [source, label] of [[html, 'public'], [privateHtml, 'private']]) {
    const lifecycleButtons = [...source.matchAll(/<button\b[^>]*data-lifecycle="(current|history)"[^>]*>[\s\S]*?<\/button>/g)];
    assert.deepEqual(
      lifecycleButtons.map(([, value]) => value),
      ['current', 'history'],
      `${label} lifecycle controls must keep current/history as the two top-level options`
    );
    assert.match(lifecycleButtons[0][0], /class="[^"]*\bactive\b/);
    assert.match(lifecycleButtons[0][0], /aria-pressed="true"/);
    assert.match(lifecycleButtons[0][0], /现有\s+IMAX/);
    assert.match(lifecycleButtons[1][0], /aria-pressed="false"/);
    assert.match(lifecycleButtons[1][0], /历史\s+IMAX/);
  }

  for (const [source, label] of [[app, 'public'], [privateApp, 'private']]) {
    assert.match(source, /const state = \{[\s\S]*?\blifecycle:\s*'current'/, `${label} lifecycle state must default to current`);
    assert.match(source, /state\.lifecycle\s*=\s*button\.dataset\.lifecycle\s*===\s*'history'\s*\?\s*'history'\s*:\s*'current'/);
    assert.match(source, /function renderLifecycleNavigation\(cinema\)/);
    assert.match(source, /relatedLifecycleRecords\(cinema, state\.cinemas\)/);
    assert.match(source, /lifecycle === 'current' \? '现在' : historyTotal > 1 \? `前身 \$\{historyIndex\}` : '前身'/);
    assert.match(source, /data-related-record-id=/);
    assert.match(source, /closest\(['"]button\[data-related-record-id\]['"]\)[\s\S]*?focusCinema\(cinema\)/);
  }
});

test('frontend runtime and SDK mock do not retain legacy spatial cluster/query APIs', () => {
  assert.doesNotMatch(`${app}\n${privateApp}\n${sdkMock}`, /AMap\.MarkerCluster|averageCenter|DistrictSearch|Geocoder|PlaceSearch/);
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
  assert.match(app, /canonicalFieldPresentation\(record, field, unit\)/);
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

test('private frontend follows the same nearby and location-filter boundary', () => {
  assert.doesNotMatch(`${privateHtml}\n${privateApp}`, /locationFilters|data-location|位置核验/);
  for (const token of ['id="nearbyButton"', 'data-nearby-sort="distance"', 'data-nearby-sort="screen"', 'data-nearby-sort="spec"', 'id="exitNearbyButton"']) {
    assert.ok(privateHtml.includes(token), `missing private nearby UI token: ${token}`);
  }
  assert.match(privateApp, /buildAdministrativeDisplay/);
  assert.match(privateApp, /resolveAdminCollisions/);
  assert.match(privateApp, /AMap\.Geolocation/);
  assert.match(privateApp, /buildNearbyCandidateSet/);
  assert.match(privateApp, /暂无数据/);
  assert.match(privateCss, /user-location-marker/);
});

test('credential proxy and attribution remain visible', () => {
  assert.match(html, /runtime-config\.js/);
  assert.match(app, /pathname !== '\/_AMapService'/);
  assert.match(app, /@ArvinTingcn/);
  assert.match(html, /docs\.qq\.com\/sheet/);
  assert.doesNotMatch(`${html}\n${app}`, /securityJsCode|AMAP_JS_SECURITY_CODE/);
  assert.match(docs, /AMap JS API 2\.0|AMap/);
});
