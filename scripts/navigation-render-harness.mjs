import { buildAdministrativeDisplay } from '../admin-clusters.mjs';
import { applyFocusScope, effectiveDisplayZoom, navigationTargetZoom } from '../focus-navigation.mjs';
import { displayRenderSignature } from '../render-signature.mjs';
import { cinemaLifecycle } from '../cinema-lifecycle.mjs';

export function createNavigationRenderHarness(records, { lifecycle = 'current', mapZoom = 4 } = {}) {
  let sourceRecords = [...(records ?? [])];
  let activeItems = [];
  let lastSignature = null;
  let currentFocus = null;
  let currentZoom = mapZoom;
  const events = [];

  function render({ focus = currentFocus, requestedZoom = currentZoom } = {}) {
    const lifecycleRecords = sourceRecords.filter((record) => cinemaLifecycle(record) === lifecycle);
    const scoped = applyFocusScope(lifecycleRecords, focus);
    const effectiveZoom = effectiveDisplayZoom(requestedZoom, focus);
    const built = buildAdministrativeDisplay(scoped, effectiveZoom);
    const mode = built.mode ?? 'province';
    const items = built.map((item) => ({ ...item, offsetX: Number(item.offsetX) || 0, offsetY: Number(item.offsetY) || 0 }));
    const signature = displayRenderSignature({ lifecycle, mode, items });
    const skipped = signature === lastSignature;
    const removedCount = skipped ? 0 : activeItems.length;
    const createdCount = skipped ? 0 : items.length;
    if (!skipped) {
      activeItems = items;
      lastSignature = signature;
    }
    const event = { requestedZoom, effectiveZoom, mode, inputRecordCount: scoped.length, outputItemCount: items.length, removedCount, createdCount, skipped };
    events.push(event);
    return event;
  }

  return {
    get events() { return events; },
    get activeItems() { return activeItems; },
    setRecords(recordsToUse) { sourceRecords = [...(recordsToUse ?? [])]; },
    render,
    navigateTo(focus) {
      currentFocus = focus ?? null;
      const targetZoom = navigationTargetZoom(currentFocus);
      const first = render({ focus: currentFocus, requestedZoom: targetZoom });
      currentZoom = targetZoom;
      const zoomend = render({ focus: currentFocus, requestedZoom: currentZoom });
      return { first, zoomend };
    },
    click(index = 0) {
      const item = activeItems[index];
      return item?.records?.[0]?.id ?? item?.cinemas?.[0]?.id ?? null;
    }
  };
}
