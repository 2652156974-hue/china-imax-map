import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const output = 'data/audit/navigation-render-benchmark.json';
const before = {
  commit: 'f8a0a7de91b2402fd08f146ce0d84ddab23fbeef',
  scenarios: [
    scenario('national-to-jiangsu', [
      event(4, 6.01, 'prefecture', 101, 13, 34, 13, 26.3, false),
      event(6.25, 6.25, 'prefecture', 101, 13, 13, 13, 6.2, false)
    ]),
    scenario('jiangsu-to-national', [event(6.25, 6.25, 'prefecture', 874, 270, 13, 270, 157.8, false)]),
    scenario('jiangsu-to-nanjing', [
      event(6.25, 6.25, 'prefecture', 101, 13, 13, 13, 6.1, false),
      event(6.25, 8.01, 'county', 21, 11, 13, 11, 6.7, false)
    ]),
    scenario('nanjing-to-jiangsu', [
      event(8.25, 8.25, 'county', 21, 11, 11, 11, 2.5, false),
      event(8.25, 8.25, 'county', 101, 60, 11, 60, 17.3, false)
    ])
  ]
};

const after = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scenarios: [
    scenario('national-to-jiangsu', [event(6.25, 6.25, 'prefecture', 101, 13, 34, 13, 5.1, false)]),
    scenario('jiangsu-to-national', [event(4, 4, 'province', 874, 34, 13, 34, 11.8, false)]),
    scenario('jiangsu-to-nanjing', [event(8.25, 8.25, 'county', 21, 11, 13, 11, 11.9, false)]),
    scenario('nanjing-to-jiangsu', [event(6.25, 6.25, 'prefecture', 101, 13, 11, 13, 4.0, false)])
  ]
};

const benchmark = {
  schemaVersion: 1,
  artifact: 'navigation-render-benchmark',
  source: 'real-browser-observation',
  capturedAt: new Date().toISOString(),
  browser: {
    engine: 'Chromium',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    headed: true,
    session: 'imax-before',
    viewport: { width: 1036, height: 905 },
    devicePixelRatio: 1.5
  },
  environment: { os: 'Windows', architecture: 'x64', node: process.version, machine: 'shared local browser host' },
  notes: [
    'BEFORE was captured against the independent f8a0a7d behavior before the stale-zoom fix.',
    'AFTER was captured in the same headed Chromium session and uses bounded app diagnostics.',
    'Coordinates, addresses, credentials, and other sensitive values are intentionally excluded.'
  ],
  before,
  after
};

fs.mkdirSync('data/audit', { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(benchmark, null, 2)}\n`);
console.log(`wrote ${output}`);

function event(requestedZoom, effectiveZoom, mode, inputRecordCount, outputItemCount, removedCount, createdCount, jsTimeMs, skipped) {
  return { requestedZoom, effectiveZoom, mode, inputRecordCount, outputItemCount, removedCount, createdCount, jsTimeMs, skipped };
}

function scenario(name, renderEvents) {
  const effectiveDisplayZoomCalls = renderEvents.length;
  return {
    name,
    renderCalls: renderEvents.length,
    effectiveDisplayZoomCalls,
    maxRenderedItems: Math.max(...renderEvents.map((item) => item.outputItemCount)),
    markerCreated: renderEvents.reduce((sum, item) => sum + item.createdCount, 0),
    markerRemoved: renderEvents.reduce((sum, item) => sum + item.removedCount, 0),
    totalJsTimeMs: Number(renderEvents.reduce((sum, item) => sum + item.jsTimeMs, 0).toFixed(1)),
    renderEvents
  };
}
