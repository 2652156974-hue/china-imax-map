async (page) => {
  await page.route('https://webapi.amap.com/maps**', route => route.fulfill({
    path: 'C:/Users/wuhan/Documents/Codex/2026-08-20/github-plugin-browser-openai-bundled-mention/work/china-imax-map/scripts/fixtures/amap-js-sdk.mock.js',
    contentType: 'text/javascript'
  }));
  await page.goto('http://127.0.0.1:8766/');
  await page.waitForFunction(() => Number(window.__imaxAmapDiagnostics?.locatedRecords ?? 0) > 0);
  return page.evaluate(() => ({
    title: document.title,
    banner: document.querySelector('#dataBanner')?.textContent,
    status: document.querySelector('#status')?.textContent,
    totalPoints: document.querySelector('#mock-amap-cluster-layer')?.dataset.totalPoints,
    clusters: document.querySelectorAll('.imax-cluster').length,
    renderedMarkers: document.querySelectorAll('.imax-marker').length,
    renderer: window.__imaxAmapDiagnostics?.renderer,
    mapCrs: window.__imaxAmapDiagnostics?.mapCrs,
    errors: window.__imaxAmapDiagnostics?.errors
  }));
}
