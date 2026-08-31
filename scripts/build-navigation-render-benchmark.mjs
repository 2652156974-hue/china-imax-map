import fs from 'node:fs';
import crypto from 'node:crypto';

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
  for (const scenario of capture.scenarios) validateScenario(scenario, path);
  capture.captureDigest = crypto.createHash('sha256').update(source).digest('hex');
  return capture;
}

function validateScenario(scenario, path) {
  if (typeof scenario.name !== 'string' || !Array.isArray(scenario.renderEvents)) throw new Error(`Invalid scenario in ${path}`);
  for (const event of scenario.renderEvents) {
    for (const field of ['requestedZoom', 'effectiveZoom', 'mode', 'inputRecordCount', 'outputItemCount', 'totalRenderMs', 'skipped']) {
      if (!(field in event)) throw new Error(`Render event missing ${field} in ${path}`);
    }
    if (!event.marker || !Number.isFinite(event.marker.createdCount) || !Number.isFinite(event.marker.removedCount)) throw new Error(`Render event missing marker counts in ${path}`);
  }
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
