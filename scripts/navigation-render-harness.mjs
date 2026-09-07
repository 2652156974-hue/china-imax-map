import { buildAdministrativeDisplay } from '../admin-clusters.mjs';
import { effectiveDisplayZoom, navigationTargetZoom } from '../focus-navigation.mjs';
import { displayRenderSignature } from '../render-signature.mjs';
import { createNavigationCoordinator } from '../navigation-coordinator.mjs';
import { deriveVisibleState } from '../visible-state.mjs';

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
  let view = { focus: null, scopedLifecycleRecords: [], visibleRecords: [], locatedRecords: [] };
  let currentZoom = mapZoom;
  const events = [];
  const map = new MockMap(mapZoom);

  function renderMap({ requestedZoom = currentZoom, source = 'direct' } = {}) {
    const focus = view.focus;
    const effectiveZoom = effectiveDisplayZoom(requestedZoom, focus);
    const built = buildAdministrativeDisplay(view.locatedRecords, effectiveZoom);
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
    const event = {
      source,
      requestedZoom,
      effectiveZoom,
      mode,
      focus,
      visibleRecordCount: view.visibleRecords.length,
      inputRecordCount: view.locatedRecords.length,
      outputItemCount: items.length,
      removedCount,
      createdCount,
      skipped
    };
    events.push(event);
    return event;
  }

  function deriveAndRender({ focus = view.focus, requestedZoom = currentZoom, source = 'direct' } = {}) {
    const derived = deriveVisibleState({ cinemas: sourceRecords, focus, lifecycle: activeLifecycle });
    view = { focus, ...derived };
    return renderMap({ requestedZoom, source });
  }

  const coordinator = createNavigationCoordinator({
    map,
    getFocus: () => view.focus,
    commit: deriveAndRender,
    reconcileMap: renderMap
  });

  return {
    get events() { return events; },
    get activeItems() { return activeItems; },
    get transitions() { return map.transitions; },
    setRecords(recordsToUse) { sourceRecords = [...(recordsToUse ?? [])]; },
    setLifecycle(nextLifecycle) { activeLifecycle = nextLifecycle === 'history' ? 'history' : 'current'; },
    render: deriveAndRender,
    navigateTo(focus) {
      const firstIndex = events.length;
      const targetFocus = focus ?? null;
      const targetZoom = navigationTargetZoom(targetFocus);
      coordinator.transition({ focus: targetFocus, mapZoom: targetZoom });
      currentZoom = targetZoom;
      return { first: events[firstIndex], zoomend: events[firstIndex + 1] };
    },
    click(index = 0) {
      const item = activeItems[index];
      return item?.records?.[0]?.id ?? item?.cinemas?.[0]?.id ?? null;
    }
  };
}
