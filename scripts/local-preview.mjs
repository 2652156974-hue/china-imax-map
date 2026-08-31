const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function hasMapCoordinate(selected) {
  return isFiniteNumber(selected?.map?.lat) && isFiniteNumber(selected?.map?.lng) &&
    selected.map.lat >= -90 && selected.map.lat <= 90 &&
    selected.map.lng >= -180 && selected.map.lng <= 180;
}

function localLocation(record, auditRecord, reviewedRejection = null) {
  const selected = auditRecord?.selected;
  if (reviewedRejection) {
    return {
      ...(record.location ?? {}),
      lat: null,
      lng: null,
      address: '',
      providerLat: null,
      providerLng: null,
      providerCrs: null,
      mapCrs: null,
      positionType: null,
      locationGranularity: null,
      locationConfidence: 'unknown',
      identityConfidence: 'unknown',
      geocodeConfidence: 'unknown',
      geocodeSource: '',
      providerPoiId: null,
      previewEvidenceClass: 'reviewed-rejection',
      decisionOrigin: 'reviewed-rejection',
    };
  }
  if (!selected || selected.automaticDecision !== 'accepted-high' || !hasMapCoordinate(selected)) {
    return { ...(record.location ?? {}) };
  }

  return {
    ...(record.location ?? {}),
    lat: selected.map.lat,
    lng: selected.map.lng,
    providerLat: selected.provider?.providerLat ?? null,
    providerLng: selected.provider?.providerLng ?? null,
    providerCrs: selected.provider?.providerCrs ?? 'GCJ-02',
    mapCrs: selected.map?.mapCrs ?? 'WGS84',
    address: selected.address ?? '',
    positionType: selected.positionType ?? null,
    locationGranularity: selected.locationGranularity ?? null,
    locationConfidence: selected.locationConfidence ?? selected.confidence ?? 'unknown',
    identityConfidence: selected.identityConfidence ?? 'unknown',
    geocodeConfidence: selected.confidence ?? 'unknown',
    geocodeSource: selected.geocodeSource ?? 'amap:poi-search',
    providerPoiId: selected.poiId ?? null,
    previewEvidenceClass: auditRecord.overrideUsed ? 'existing-reviewed-override' : 'automatic-high',
  };
}

export function buildLocalPreviewDocument({
  derived,
  mainlandAudit,
  reviewedOverrides = { records: [] },
  generatedAt = new Date().toISOString()
}) {
  if (!Array.isArray(derived?.records) || derived.records.length !== 901) {
    throw new Error('Local preview requires the 901-record derived dataset');
  }
  if (!Array.isArray(mainlandAudit?.records)) {
    throw new Error('Local preview requires the mainland geocode audit');
  }

  const auditByRow = new Map(mainlandAudit.records.map((record) => [Number(record.sourceRow), record]));
  const overrideByRow = new Map((reviewedOverrides.records ?? [])
    .filter((override) => Number.isInteger(Number(override.sourceRow)))
    .map((override) => [Number(override.sourceRow), override]));
  const records = derived.records.map((record) => {
    const auditRecord = auditByRow.get(Number(record.sourceRow));
    const reviewedRejection = normalizeReviewedRejection(
      overrideByRow.get(Number(record.sourceRow)),
      record,
      auditRecord
    );
    return {
      ...record,
      location: localLocation(record, auditRecord, reviewedRejection),
      reviewedRejection,
    };
  });
  const coordinateRecords = records.filter((record) =>
    isFiniteNumber(record.location?.lat) && isFiniteNumber(record.location?.lng));
  const evidenceCounts = coordinateRecords.reduce((counts, record) => {
    const key = record.location.previewEvidenceClass ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 1,
    dataset: 'arvin-imax-local-preview-cinemas',
    mode: 'local-preview',
    generatedAt,
    status: 'LOCAL PREVIEW · NOT FOR PUBLICATION',
    publicationGate: 'BLOCKED_LOCAL_ONLY',
    coordinatesPublished: coordinateRecords.length,
    source: {
      maintainer: '@ArvinTingcn',
      document: '全球IMAX及特效影厅分布20260820',
      url: 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2',
      tabId: 'BB08J2',
      tab: 'IMAX中国',
    },
    policy: {
      localOnly: true,
      amapCoordinatesIncluded: true,
      amapRawCandidatesIncluded: false,
      providerCacheIncluded: false,
      rawTencentSnapshotIncluded: false,
      noCityCenterFallback: true,
      sourceAudit: 'data/audit/geocode-mainland-full.json',
      selectedEvidence: 'accepted-high only, including existing reviewed overrides',
      note: 'LOCAL PREVIEW · NOT FOR PUBLICATION; AMap-derived coordinates must not be committed or deployed.',
    },
    coordinatePolicy: {
      providerCrs: 'GCJ-02',
      mapCrs: 'WGS84',
      conversionPerformedInDataLayer: true,
      frontendConversion: false,
    },
    summary: {
      records: records.length,
      coordinatesPublishedLocally: coordinateRecords.length,
      nullCoordinates: records.length - coordinateRecords.length,
      evidenceCounts,
    },
    records,
  };
}

function normalizeReviewedRejection(override, record, auditRecord) {
  if (!override || override.status !== 'rejected-cached-poi') return null;
  if (Number(override.sourceRow) !== Number(record.sourceRow)) {
    throw new Error(`Reviewed rejection sourceRow mismatch at ${record.sourceRow}.`);
  }
  if (override.provider !== 'amap' || typeof override.poiId !== 'string' || !override.poiId) {
    throw new Error(`Reviewed rejection requires an AMap POI at sourceRow ${record.sourceRow}.`);
  }
  if (auditRecord?.selected?.poiId !== override.poiId) {
    throw new Error(`Reviewed rejection POI is not the selected cache POI at sourceRow ${record.sourceRow}.`);
  }
  return {
    sourceRow: Number(record.sourceRow),
    status: override.status,
    provider: override.provider,
    poiId: override.poiId,
    verdict: override.verdict ?? 'reject-wrong-poi',
    replacementPoiId: override.replacementPoiId ?? null,
    evidenceUrls: Array.isArray(override.evidenceUrls) ? [...override.evidenceUrls] : [],
    reasonCode: override.reasonCode ?? 'reviewed-rejection',
    reason: override.evidence ?? '',
    reviewedAt: override.reviewedAt ?? null,
    provenance: override.provenance ?? null,
  };
}
