import fs from 'node:fs';
import crypto from 'node:crypto';

const FORBIDDEN_FIELD_NAMES = new Set([
  'providerlat', 'providerlng', 'lnglat', 'latitude', 'longitude', 'coordinate', 'coordinates',
  'rawcandidates', 'rawrecord', 'markerinput', 'firstrecord', 'secret', 'jscode', 'apikey',
  'password', 'token'
]);

const args = new Map(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const beforePath = args.get('before');
const afterPath = args.get('after');
const outputPath = args.get('output') ?? 'data/audit/navigation-render-benchmark.json';
if (!beforePath || !afterPath) throw new Error('Usage: node scripts/build-navigation-render-benchmark.mjs --before <capture> --after <capture> [--output <file>]');

const before = readCapture(beforePath, 'before');
const after = readCapture(afterPath, 'after');
const names = ['national-to-jiangsu', 'jiangsu-to-national', 'jiangsu-to-nanjing', 'nanjing-to-jiangsu'];
if (JSON.stringify(before.scenarios.map((scenario) => scenario.name)) !== JSON.stringify(names) || JSON.stringify(after.scenarios.map((scenario) => scenario.name)) !== JSON.stringify(names)) {
  throw new Error('Benchmark captures must contain the four canonical navigation scenarios in order.');
}
if (JSON.stringify(before.environment) !== JSON.stringify(after.environment)) throw new Error('BEFORE and AFTER captures must use the same environment.');
if (JSON.stringify(before.browser) !== JSON.stringify(after.browser)) throw new Error('BEFORE and AFTER captures must use the same browser configuration.');
for (let index = 0; index < names.length; index += 1) {
  if (JSON.stringify(before.scenarios[index].filters) !== JSON.stringify(after.scenarios[index].filters)) {
    throw new Error(`BEFORE and AFTER filters differ for ${names[index]}.`);
  }
}

const benchmark = {
  schemaVersion: 2,
  artifact: 'navigation-render-benchmark',
  source: 'real-browser-capture',
  capturedAt: { before: before.capturedAt, after: after.capturedAt },
  browser: after.browser,
  environment: after.environment,
  before: normalizeCapture(before),
  after: normalizeCapture(after),
  validation: {
    sameBrowserSession: before.browser.session === after.browser.session && before.browser.userAgent === after.browser.userAgent,
    sameEnvironment: JSON.stringify(before.environment) === JSON.stringify(after.environment),
    forbiddenPayloadFields: []
  }
};
if (!benchmark.validation.sameBrowserSession || !benchmark.validation.sameEnvironment) throw new Error('BEFORE and AFTER captures must use the same browser and environment.');
fs.mkdirSync('data/audit', { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(benchmark, null, 2)}\n`);
console.log(`wrote ${outputPath}`);

function readCapture(path, expectedKind) {
  const source = fs.readFileSync(path);
  const capture = JSON.parse(source);
  if (capture.schemaVersion !== 1 || capture.captureKind !== expectedKind || !Array.isArray(capture.scenarios)) throw new Error(`Invalid ${expectedKind} capture: ${path}`);
  const forbiddenFields = findForbiddenFields(capture);
  if (forbiddenFields.length) throw new Error(`Forbidden fields in ${expectedKind} capture: ${forbiddenFields.join(', ')}`);
  for (const scenario of capture.scenarios) validateScenario(scenario, path);
  capture.captureDigest = crypto.createHash('sha256').update(source).digest('hex');
  return capture;
}

function validateScenario(scenario, path) {
  if (typeof scenario.name !== 'string' || !Array.isArray(scenario.renderEvents) || !scenario.filters || !scenario.zoom || !scenario.waits) throw new Error(`Invalid scenario in ${path}`);
  if (scenario.waits.zoomend !== true || Number(scenario.waits.quietWindowMs) < 1800) throw new Error(`Scenario must await zoomend and a quiet window >= 1800ms in ${path}`);
  if (!Number.isFinite(Number(scenario.zoom.target))) throw new Error(`Scenario is missing a target zoom in ${path}`);
  if (!scenario.renderEvents.length) throw new Error(`Scenario has no render events in ${path}`);
  for (const event of scenario.renderEvents) {
    for (const field of ['requestedZoom', 'effectiveZoom', 'mode', 'inputRecordCount', 'outputItemCount', 'totalRenderMs', 'skipped']) {
      if (!(field in event)) throw new Error(`Render event missing ${field} in ${path}`);
    }
    if (!event.marker || !Number.isFinite(event.marker.createdCount) || !Number.isFinite(event.marker.removedCount)) throw new Error(`Render event missing marker counts in ${path}`);
  }
  const finalEvent = scenario.renderEvents.at(-1);
  const expectedMode = scenario.focus.to === '全国' ? 'province' : scenario.focus.to === '江苏' ? 'prefecture' : 'county';
  if (Number(finalEvent.requestedZoom) !== Number(scenario.zoom.target) || Number(finalEvent.effectiveZoom) !== Number(scenario.zoom.target)) {
    throw new Error(`Final render event does not reach declared target zoom in ${path}`);
  }
  if (finalEvent.mode !== expectedMode) throw new Error(`Final render event does not reach target mode in ${path}`);
}

function normalizeCapture(capture) {
  return {
    captureKind: capture.captureKind,
    commit: capture.commit,
    captureDigest: capture.captureDigest,
    browser: capture.browser,
    environment: capture.environment,
    scenarios: capture.scenarios.map((scenario) => {
      const renderEvents = scenario.renderEvents.map((event) => ({
        requestedZoom: event.requestedZoom,
        effectiveZoom: event.effectiveZoom,
        mode: event.mode,
        inputRecordCount: event.inputRecordCount,
        outputItemCount: event.outputItemCount,
        totalRenderMs: event.totalRenderMs,
        marker: event.marker,
        skipped: event.skipped,
        source: event.source ?? null
      }));
      return {
        name: scenario.name,
        filters: scenario.filters,
        runtimeState: scenario.runtimeState ?? null,
        focus: scenario.focus,
        zoom: scenario.zoom,
        waits: scenario.waits,
        renderCalls: renderEvents.length,
        markerMutatingRenderCalls: renderEvents.filter((event) => !event.skipped && (event.marker.createdCount !== 0 || event.marker.removedCount !== 0)).length,
        maxRenderedItems: Math.max(0, ...renderEvents.map((event) => event.outputItemCount)),
        markerCreated: renderEvents.reduce((sum, event) => sum + event.marker.createdCount, 0),
        markerRemoved: renderEvents.reduce((sum, event) => sum + event.marker.removedCount, 0),
        totalJsTimeMs: Number(renderEvents.reduce((sum, event) => sum + event.totalRenderMs, 0).toFixed(1)),
        renderEvents
      };
    })
  };
}

function findForbiddenFields(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenFields(entry, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) found.push(`${path}.${key}`);
    findForbiddenFields(entry, `${path}.${key}`, found);
  }
  return found;
}
