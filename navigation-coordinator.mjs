import { navigationTargetZoom } from './focus-navigation.mjs';

/**
 * Shared ordering for administrative navigation: commit the complete target
 * view first, schedule the map transition second, and keep zoomend map-only.
 */
export function createNavigationCoordinator({
  map = null,
  getFocus = () => null,
  commit,
  reconcileMap = () => null,
  afterTransition = () => null
} = {}) {
  if (typeof commit !== 'function') throw new TypeError('navigation coordinator requires a commit callback');
  const handleZoomEnd = () => reconcileMap({
    focus: getFocus(),
    requestedZoom: map?.getZoom?.() ?? 4,
    source: 'zoomend'
  });
  map?.on?.('zoomend', handleZoomEnd);
  return {
    transition({ focus = getFocus(), center = null, mapZoom = navigationTargetZoom(focus), duration = 420, context = null } = {}) {
      const requestedZoom = navigationTargetZoom(focus);
      const committed = commit({ focus, requestedZoom, source: 'navigation', context });
      map?.setZoomAndCenter?.(mapZoom, center, false, duration);
      afterTransition({ focus, requestedZoom, source: 'navigation', context, committed });
      return committed;
    },
    dispose() { map?.off?.('zoomend', handleZoomEnd); }
  };
}
