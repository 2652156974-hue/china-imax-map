import { buildAdministrativeDisplay } from '../admin-clusters.mjs';
import { applyFocusScope, effectiveDisplayZoom, navigationTargetZoom } from '../focus-navigation.mjs';
import { displayRenderSignature } from '../render-signature.mjs';
import { cinemaLifecycle } from '../cinema-lifecycle.mjs';
import { createNavigationCoordinator } from '../navigation-coordinator.mjs';

class MockMap {
  constructor(zoom) { this.zoom = zoom; this.listeners = new Map(); this.transitions = []; }
  on(event, listener) { this.listeners.set(event, listener); }
  off(event, listener) { if (this.listeners.get(event) === listener) this.listeners.delete(event); }
  getZoom() { return this.zoom; }
  setZoomAndCenter(zoom, center, animate, duration) {
    this.zoom = zoom;
    this.transitions.push({ zoom, center, animate, duration });
    this.listeners.get('zoomend')?.();
  }
}

export function createNavigationRenderHarness(records, { lifecycle = 'current', mapZoom = 4 } = {}) {
  let sourceRecords = [...(records ?? [])];
  let activeLifecycle = lifecycle;
  let activeItems = [];
  let lastSignature = null;
  let currentFocus = null;
  let currentZoom = mapZoom;
  const events = [];
  const map = new MockMap(mapZoom);

  function render({ focus = currentFocus, requestedZoom = currentZoom, source = 'direct' } = {}) {
    const lifecycleRecords = sourceRecords.filter((record) => cinemaLifecycle(record) === activeLifecycle);
    const scoped = applyFocusScope(lifecycleRecords, focus);
    const effectiveZoom = effectiveDisplayZoom(requestedZoom, focus);
    const built = buildAdministrativeDisplay(scoped, effectiveZoom);
    const mode = built.mode ?? 'province';
    const items = built.map((item) => ({ ...item, offsetX: Number(item.offsetX) || 0, offsetY: Number(item.offsetY) || 0 }));
    const signature = displayRenderSignature({ lifecycle: activeLifecycle, mode, items });
    const skipped = signature === lastSignature;
    const removedCount = skipped ? 0 : activeItems.length;
    const createdCount = skipped ? 0 : items.length;
    if (!skipped) {
      activeItems = items;
      lastSignature = signature;
    }
    const event = { source, requestedZoom, effectiveZoom, mode, inputRecordCount: scoped.length, outputItemCount: items.length, removedCount, createdCount, skipped };
    events.push(event);
    return event;
  }

  const coordinator = createNavigationCoordinator({ map, getFocus: () => currentFocus, render });

  return {
    get events() { return events; },
    get activeItems() { return activeItems; },
    get transitions() { return map.transitions; },
    setRecords(recordsToUse) { sourceRecords = [...(recordsToUse ?? [])]; },
    setLifecycle(nextLifecycle) { activeLifecycle = nextLifecycle === 'history' ? 'history' : 'current'; },
    render,
    navigateTo(focus) {
      currentFocus = focus ?? null;
      const firstIndex = events.length;
      const targetZoom = navigationTargetZoom(currentFocus);
      coordinator.transition({ focus: currentFocus, mapZoom: targetZoom });
      currentZoom = targetZoom;
      return { first: events[firstIndex], zoomend: events[firstIndex + 1] };
    },
    click(index = 0) {
      const item = activeItems[index];
      return item?.records?.[0]?.id ?? item?.cinemas?.[0]?.id ?? null;
    }
  };
}
