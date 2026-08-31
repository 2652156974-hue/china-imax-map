/**
 * Stable identity for one administrative marker render.
 *
 * The signature intentionally includes every value consumed by marker HTML,
 * offset placement, or the click closure. Ordered member identities prevent
 * two same-coordinate cinema records from being treated as interchangeable.
 */
export function displayRenderSignature({ lifecycle = 'current', mode = 'province', items = [] } = {}) {
  return JSON.stringify({
    lifecycle,
    mode,
    items: items.map((item) => {
      const records = item.records ?? item.cinemas ?? [];
      return {
        key: item.adminKey ?? item.key ?? item.siteKey ?? null,
        kind: item.kind,
        level: item.level,
        fallback: Boolean(item.fallback),
        sizeClass: item.sizeClass,
        count: item.count,
        name: item.name,
        lnglat: item.lnglat,
        offsetX: Number(item.offsetX) || 0,
        offsetY: Number(item.offsetY) || 0,
        members: records.map((record) => ({
          id: record?.id ?? null,
          sourceRow: record?.sourceRow ?? null,
          name: record?.name ?? null
        })),
        firstRecord: records[0] ?? null,
        // `enterAdministrativeFocus(item)` receives the whole item and the
        // marker closure reads its position/kind/first record. Keep the full
        // item payload in the identity so a newly relevant click/HTML field
        // cannot be mistaken for an unchanged marker.
        markerInput: item
      };
    })
  });
}
