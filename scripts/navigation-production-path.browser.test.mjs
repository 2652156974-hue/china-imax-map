import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createPublicAmapServer, loadPublicServerConfig } from './public-amap-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_FILES = [
  'index.html', 'app.mjs', 'styles.css', 'nearby.mjs', 'admin-clusters.mjs',
  'cinema-lifecycle.mjs', 'focus-navigation.mjs', 'focus-navigation.css',
  'marker-render-descriptor.mjs', 'navigation-coordinator.mjs',
  'render-signature.mjs', 'visible-state.mjs'
];

test('production app navigation atomically commits Nanjing to Jiangsu and Jiangsu to national', { timeout: 45_000 }, async (t) => {
  const chromePath = findChrome();
  if (!chromePath) return t.skip('Chrome/Chromium is required for the production browser-path integration test.');

  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imax-production-navigation-'));
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imax-production-chrome-'));
  fs.mkdirSync(path.join(distRoot, 'data'));
  for (const filename of PUBLIC_FILES) fs.copyFileSync(path.join(ROOT, filename), path.join(distRoot, filename));
  fs.copyFileSync(path.join(ROOT, 'data/public/cinemas.json'), path.join(distRoot, 'data/cinemas.json'));

  const config = loadPublicServerConfig({
    PUBLIC_AMAP_HOST: '127.0.0.1',
    PUBLIC_AMAP_PORT: '0',
    PUBLIC_AMAP_DIST: distRoot,
    PUBLIC_AMAP_REVIEWED_FILE: path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json'),
    AMAP_JS_API_KEY: 'browser-test-key',
    AMAP_JS_SECURITY_CODE: 'browser-test-code',
    AMAP_JS_SDK_URL: '/__smoke/amap-js-sdk.mock.js'
  });
  const server = createPublicAmapServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const appPort = server.address().port;
  const debugPort = await reservePort();
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileRoot}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const target = await waitForPageTarget(debugPort);
    cdp = await createCdpClient(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` });
    await waitFor(() => evaluate(cdp, 'window.__imaxMapDiagnostics?.totalRecords === 901'));

    await clickAdministrativeMarker(cdp, '江苏');
    await waitForFocus(cdp, '江苏', 1);
    await clickAdministrativeMarker(cdp, '南京');
    await waitForFocus(cdp, '南京', 2);

    const beforeNanjingReturn = await diagnosticLengths(cdp);
    await evaluate(cdp, `document.querySelector('#focusBack').click()`);
    await waitForFocus(cdp, '江苏', 1);
    const nanjingToJiangsu = await navigationSnapshot(cdp, beforeNanjingReturn);
    assertAtomicTransition(nanjingToJiangsu, {
      focusScope: '江苏',
      visibleRecordCount: 101,
      displayMode: 'prefecture'
    });

    const beforeNationalReturn = await diagnosticLengths(cdp);
    await evaluate(cdp, `document.querySelector('#focusBack').click()`);
    await waitForFocus(cdp, '全国', 0);
    const jiangsuToNational = await navigationSnapshot(cdp, beforeNationalReturn);
    assertAtomicTransition(jiangsuToNational, {
      focusScope: '全国',
      visibleRecordCount: 874,
      displayMode: 'province',
      focus: null
    });
    assert.equal(jiangsuToNational.recordListResultCount, 874);
    assert.equal(jiangsuToNational.renderedRecordResultCount, 874);
    assert.match(jiangsuToNational.status, /现有 874 \/ 874/);

    for (const snapshot of [nanjingToJiangsu, jiangsuToNational]) {
      const timing = snapshot.transaction;
      for (const field of ['deriveVisibleStateMs', 'mapRenderMs', 'recordListRenderMs', 'navigationUiMs', 'handlerTotalMs']) {
        assert.ok(Number.isFinite(timing[field]) && timing[field] >= 0, `${field} must be captured`);
      }
      assert.ok(timing.handlerTotalMs >= timing.deriveVisibleStateMs, 'handler total must cover derivation');
      assert.ok(timing.mainThreadFreeForNextFrameMs >= timing.handlerTotalMs, 'next-frame availability must follow handler completion');
      assert.ok(Array.isArray(timing.longTasks), 'Long Tasks capture must be present when supported');
    }
  } finally {
    cdp?.close();
    chrome.kill();
    await Promise.race([
      once(chrome, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(distRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function assertAtomicTransition(snapshot, expected) {
  assert.ok(snapshot.renderEvents.length >= 1, 'navigation must produce an effective render');
  const first = snapshot.renderEvents[0];
  assert.equal(first.source, 'navigation');
  assert.equal(first.focusScope, expected.focusScope);
  assert.equal(first.visibleRecordCount, expected.visibleRecordCount);
  assert.equal(first.inputRecordCount, expected.visibleRecordCount);
  assert.equal(first.displayMode, expected.displayMode);
  if (Object.hasOwn(expected, 'focus')) assert.equal(first.focus, expected.focus);
  assert.ok(snapshot.renderEvents.every((event) => event.displayMode === expected.displayMode));
  assert.ok(snapshot.renderEvents.every((event) => !['spread', 'cinema'].includes(event.displayMode)));
  assert.equal(snapshot.transaction.targetVisibleRecordCount, expected.visibleRecordCount);
  assert.equal(snapshot.transaction.displayMode, expected.displayMode);
}

async function clickAdministrativeMarker(cdp, name) {
  const clicked = await evaluate(cdp, `(() => {
    const marker = [...document.querySelectorAll('#map .admin-cluster')]
      .find((item) => item.querySelector('.admin-cluster__name')?.textContent === ${JSON.stringify(name)});
    if (!marker) return false;
    marker.click();
    return true;
  })()`);
  assert.equal(clicked, true, `administrative marker ${name} must be present`);
}

async function waitForFocus(cdp, scope, depth) {
  await waitFor(async () => {
    const state = await evaluate(cdp, `({ scope: window.__imaxMapDiagnostics.focusScope, depth: window.__imaxMapDiagnostics.focusDepth })`);
    return state.scope === scope && state.depth === depth;
  });
}

async function diagnosticLengths(cdp) {
  return evaluate(cdp, `({
    renderEvents: window.__imaxMapDiagnostics.renderEvents.length,
    navigationTransactions: window.__imaxMapDiagnostics.navigationTransactions.length
  })`);
}

async function navigationSnapshot(cdp, before) {
  await waitFor(() => evaluate(cdp, `Number.isFinite(
    window.__imaxMapDiagnostics.navigationTransactions[${before.navigationTransactions}]?.mainThreadFreeForNextFrameMs
  )`));
  return evaluate(cdp, `(() => {
    const diagnostics = window.__imaxMapDiagnostics;
    const moreText = document.querySelector('#recordList .record-more')?.textContent ?? '';
    const hiddenCount = Number(moreText.match(/([0-9]+)/)?.[1] ?? 0);
    return {
      renderEvents: diagnostics.renderEvents.slice(${before.renderEvents}),
      transaction: diagnostics.navigationTransactions[${before.navigationTransactions}],
      recordListResultCount: diagnostics.recordListResultCount,
      renderedRecordResultCount: document.querySelectorAll('#recordList .record-item').length + hiddenCount,
      status: document.querySelector('#status').textContent
    };
  })()`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForPageTarget(port) {
  let lastError;
  for (let index = 0; index < 100; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error('Chrome DevTools target did not start');
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for browser state');
}

async function createCdpClient(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result ?? {});
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); }
  };
}

function findChrome() {
  const candidates = process.platform === 'win32' ? [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ] : [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}
