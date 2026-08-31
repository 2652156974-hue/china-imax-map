async (page) => {
  await page.unroute('https://webapi.amap.com/maps**');
  await page.goto('http://127.0.0.1:8766/');
  await page.waitForFunction(() => (
    window.AMap?.Map &&
    Number(window.__imaxAmapDiagnostics?.locatedRecords ?? 0) > 0 &&
    window.__imaxAmapDiagnostics?.errors?.length === 0
  ), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  return page.evaluate(() => ({
    title: document.title,
    sdkLoaded: Boolean(window.AMap?.Map),
    markerClusterLoaded: Boolean(window.AMap?.MarkerCluster),
    renderer: window.__imaxAmapDiagnostics?.renderer,
    mapCrs: window.__imaxAmapDiagnostics?.mapCrs,
    totalRecords: window.__imaxAmapDiagnostics?.totalRecords,
    locatedRecords: window.__imaxAmapDiagnostics?.locatedRecords,
    visibleMarkers: window.__imaxAmapDiagnostics?.visibleMarkers,
    errors: window.__imaxAmapDiagnostics?.errors,
    amapPoiRequests: window.__imaxAmapDiagnostics?.amapPoiRequests,
    amapLogoVisible: Boolean(document.querySelector('.amap-logo')),
    amapCopyrightVisible: Boolean(document.querySelector('.amap-copyright')),
    mapCanvasPresent: Boolean(document.querySelector('.amap-layer canvas, .amap-maps canvas')),
    banner: document.querySelector('#dataBanner')?.textContent,
    status: document.querySelector('#status')?.textContent
  }));
}
