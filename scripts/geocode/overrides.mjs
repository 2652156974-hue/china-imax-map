export function reviewedOverrideFor(overrides, sourceRow) {
  return (overrides?.records ?? []).find((item) => Number(item.sourceRow) === Number(sourceRow)) ?? null;
}

export function applyReviewedOverride(record, result, override) {
  if (!override) return { ...result, override: null };
  if (override.status !== 'approved-cached-poi' || !override.poiId) {
    return { ...result, selected: null, override: { ...override, applied: false, reason: 'reviewed-target-not-present-in-cache' } };
  }
  const candidate = result.ranked.find((item) => item.poiId === override.poiId);
  if (!candidate) {
    return { ...result, selected: null, override: { ...override, applied: false, reason: 'approved-poi-not-present-in-record-cache' } };
  }
  if (candidate.hardRejects.length) {
    return { ...result, selected: null, override: { ...override, applied: false, reason: 'approved-poi-failed-hard-reject', hardRejects: candidate.hardRejects } };
  }
  const decision = override.confidence === 'high' ? 'accepted-high' : 'review-required-medium';
  return {
    ...result,
    selected: {
      ...candidate,
      decision,
      confidence: override.confidence,
      positionType: override.positionType ?? candidate.positionType,
      locationGranularity: override.locationGranularity
        ?? (override.positionType === 'venue-poi' ? 'venue' : override.positionType === 'mall-fallback' ? 'mall' : candidate.locationGranularity),
      locationConfidence: override.locationConfidence ?? override.confidence,
      identityConfidence: override.identityConfidence ?? candidate.identityConfidence,
      geocodeSource: override.positionType === 'mall-fallback' ? 'amap:mall-fallback' : override.positionType === 'venue-poi' ? 'amap:venue-poi' : 'amap:poi-search',
      reviewedOverride: { evidence: override.evidence, provenance: override.provenance }
    },
    override: { ...override, applied: true }
  };
}
