import { navigationTargetZoom } from './focus-navigation.mjs';

/**
 * Shared ordering for administrative navigation: update focus first, render
 * at its explicit target zoom, then let the map transition emit zoomend.
 */
export function createNavigationCoordinator({ map = null, getFocus = () => null, render } = {}) {
  if (typeof render !== 'function') throw new TypeError('navigation coordinator requires a render callback');
  const handleZoomEnd = () => render({ focus: getFocus(), requestedZoom: map?.getZoom?.() ?? 4, source: 'zoomend' });
  map?.on?.('zoomend', handleZoomEnd);
  return {
    transition({ focus = getFocus(), center = null, mapZoom = navigationTargetZoom(focus), duration = 420 } = {}) {
      const requestedZoom = navigationTargetZoom(focus);
      const rendered = render({ focus, requestedZoom, source: 'navigation' });
      map?.setZoomAndCenter?.(mapZoom, center, false, duration);
      return rendered;
    },
    dispose() { map?.off?.('zoomend', handleZoomEnd); }
  };
}
