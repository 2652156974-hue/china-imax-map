import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gcj02ToWgs84 } from './geocode/crs.mjs';
import {
  AMAP_CACHE_FILE,
  CANONICAL_FILE,
  HUMAN_QUEUE_FILE,
  hasCoordinate,
  normalizeAmapCandidate,
  readJson,
  writeJson
} from './geocode/amap-human-utils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS_FILE = path.join(ROOT, 'data/audit/human-verification-results.json');
const ALLOWED_RESULTS = new Set(['same entity', 'same mall/venue only', 'different branch', 'still ambiguous', 'acceptedhistoricallocation']);

export function readResults(filePath = RESULTS_FILE) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = readJson(filePath);
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.results) ? parsed.results : [];
}

export function coordinateFingerprint(records) {
  return crypto.createHash('sha256').update(records.filter(hasCoordinate).map((record) => `${record.id}|${record.sourceRow}|${record.location.lat}|${record.location.lng}|${record.location.providerPoiId ?? ''}`).sort().join('\n')).digest('hex');
}

export function rawFingerprint(records) {
  return crypto.createHash('sha256').update(records.map((record) => `${record.id}|${record.sourceRow}|${record.screen?.rawWidth ?? ''}|${record.screen?.rawHeight ?? ''}|${record.screen?.rawArea ?? ''}|${record.seatsRaw ?? ''}`).sort().join('\n')).digest('hex');
}

export function applyHumanResults({ canonical, queue, results, now = new Date().toISOString() }) {
  const byKey = new Map(queue.records.map((record) => [`${record.id}|${record.sourceRow}`, record]));
  const seen = new Set();
  const nextRecords = canonical.records.map((record) => {
    const key = `${record.id}|${record.sourceRow}`;
    const result = results.find((item) => `${item.id ?? record.id}|${item.sourceRow ?? record.sourceRow}` === key);
    if (!result) return record;
    const queueRecord = byKey.get(key);
    if (record.reviewState !== 'unresolved') return record;
    if (seen.has(key)) throw new Error(`Duplicate human verification result for ${key}.`);
    seen.add(key);
    if (!queueRecord) throw new Error(`Human verification result does not match the current queue: ${key}.`);
    return applyOne(record, queueRecord, result, now);
  });
  return { records: nextRecords, applied: seen.size };
}

function applyOne(record, queueRecord, result, now) {
  const verdict = String(result.result ?? '').trim().toLowerCase();
  if (!ALLOWED_RESULTS.has(verdict)) throw new Error(`Invalid human result for sourceRow ${record.sourceRow}: ${result.result}`);
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  validateEvidence(evidence, record.sourceRow);
  const historicalLocation = verdict === 'acceptedhistoricallocation' ? buildHistoricalLocation(result, record) : null;
  const explicitVenueLocation = verdict === 'same mall/venue only' ? buildExplicitVenueLocation(result, record) : null;
  const explicitCinemaLocation = verdict === 'same entity' ? buildExplicitCinemaLocation(result, record) : null;
  const candidate = historicalLocation || explicitVenueLocation || explicitCinemaLocation ? null : chooseCandidate(queueRecord, result.amapProviderPoiId ?? result.providerPoiId ?? null, verdict);
  const humanNote = String(result.notes ?? '').trim();
  const evidenceUrls = evidence.map((item) => item.url).filter((url) => /^https?:\/\//i.test(String(url)));
  const sharedReview = {
    ...(record.review ?? {}),
    evidenceUrls: unique([...(record.review?.evidenceUrls ?? []), ...evidenceUrls]),
    reviewer: result.reviewer ?? 'user-human-verification',
    reviewedAt: result.reviewedAt ?? now,
    explicitVerdict: true,
    reviewSource: 'human-web-verification',
    validationErrors: [],
    notes: humanNote || `User human verification result: ${verdict}.`,
    humanVerification: {
      result: verdict,
      evidence,
      confirmationSource: result.confirmationSource ?? 'user-human-verification'
    }
  };
  const next = structuredClone(record);
  next.decisionOrigin = 'human-web-verification';
  next.review = sharedReview;
  next.supplemental = {
    ...(record.supplemental ?? {}),
    evidenceUrls: unique([...(record.supplemental?.evidenceUrls ?? []), ...evidenceUrls]),
    lastVerifiedAt: result.reviewedAt ?? now,
    reviewNotes: humanNote || `User human verification result: ${verdict}.`,
    currentIdentityAssessment: verdict,
    ...(result.status ? { humanStatusAssessment: result.status } : {})
  };
  if (verdict === 'acceptedhistoricallocation') {
    next.location = historicalLocation.location;
    next.reviewState = 'located';
    next.reviewVerdict = 'accept-historical-location';
    next.finalVerdict = 'accepted-historical-location';
    next.finalUnresolvedReason = null;
    next.review = {
      ...sharedReview,
      verdict: next.reviewVerdict,
      acceptedPoiId: historicalLocation.location.providerPoiId,
      reviewedCandidate: historicalLocation.reviewedCandidate,
      positionType: historicalLocation.location.positionType,
      locationGranularity: historicalLocation.location.locationGranularity,
      locationConfidence: historicalLocation.location.locationConfidence,
      identityConfidence: historicalLocation.location.identityConfidence,
      historicalLocation: historicalLocation.metadata
    };
    next.supplemental = {
      ...(next.supplemental ?? {}),
      historicalLocation: historicalLocation.metadata
    };
  } else if (verdict === 'same entity' || verdict === 'same mall/venue only') {
    if (!candidate && !explicitVenueLocation && !explicitCinemaLocation) throw new Error(`Accepted human result for sourceRow ${record.sourceRow} has no usable candidate or explicit location.`);
    const accepted = verdict === 'same entity' ? 'accepted-exact' : 'accepted-location-only';
    const historical = verdict === 'same entity' && /closed|temporarily_closed/i.test(String(record.status ?? ''));
    const finalVerdict = historical ? 'accepted-historical-location' : accepted;
    const reviewedCandidate = explicitVenueLocation?.reviewedCandidate ?? explicitCinemaLocation?.reviewedCandidate ?? candidate;
    const location = explicitVenueLocation?.location ?? explicitCinemaLocation?.location ?? buildLocation(candidate, verdict === 'same mall/venue only' ? 'venue' : 'cinema', result);
    next.location = location;
    next.reviewState = 'located';
    next.reviewVerdict = finalVerdict === 'accepted-exact' ? 'accept-exact' : finalVerdict === 'accepted-location-only' ? 'accept-location-only' : 'accept-historical-location';
    next.finalVerdict = finalVerdict;
    next.finalUnresolvedReason = null;
    next.review = {
      ...sharedReview,
      verdict: next.reviewVerdict,
      acceptedPoiId: reviewedCandidate.providerPoiId ?? null,
      reviewedCandidate,
      positionType: location.positionType,
      locationGranularity: location.locationGranularity,
      locationConfidence: 'high',
      identityConfidence: finalVerdict === 'accepted-location-only' ? 'medium' : 'high'
    };
  } else {
    next.location = clearLocation(record.location);
    next.reviewState = 'unresolved';
    next.reviewVerdict = 'unresolved';
    next.finalVerdict = 'unresolved';
    next.finalUnresolvedReason = verdict === 'different branch' ? 'branch-ambiguity' : record.finalUnresolvedReason ?? 'insufficient-evidence';
    next.review = {
      ...sharedReview,
      verdict: 'unresolved',
      acceptedPoiId: null,
      reviewedCandidate: null,
      positionType: null,
      locationGranularity: null,
      locationConfidence: null,
      identityConfidence: 'low'
    };
  }
  return next;
}

function validateEvidence(evidence, sourceRow) {
  for (const item of evidence) {
    if (!item || typeof item !== 'object') throw new Error(`Invalid human evidence for sourceRow ${sourceRow}.`);
    if (item.url && !/^https?:\/\//i.test(String(item.url))) throw new Error(`Human evidence URL is not http(s) for sourceRow ${sourceRow}.`);
    if (item.tier && !/^Tier [123]/.test(String(item.tier))) throw new Error(`Human evidence tier is invalid for sourceRow ${sourceRow}.`);
  }
}

function chooseCandidate(queueRecord, requestedPoiId, verdict = 'same entity') {
  const candidates = queueRecord.bestAmapCandidates ?? [];
  const candidate = requestedPoiId
    ? candidates.find((item) => String(item.providerPoiId) === String(requestedPoiId)) ?? findAmapCandidateInCache(queueRecord, requestedPoiId)
    : candidates[0];
  if (!candidate) return null;
  const hardRejects = candidate.hardRejects ?? [];
  const hasLocationConflict = hardRejects.some((reason) => ['city-mismatch', 'invalid-location'].includes(reason));
  const explicitCinemaName = /影院|影城|影都|戏院|戲院|IMAX|cinema/i.test(String(candidate.name ?? ''));
  const cinemaLikeCandidate = candidate.kind === 'cinema' || explicitCinemaName;
  const venueLikeCandidate = candidate.kind === 'venue' || candidate.kind === 'mall' || candidate.kind === 'other';
  // A human-selected, independently verified cinema may override AMap's
  // non-location heuristics (brand/branch/type/format), but never a city or
  // coordinate conflict. This keeps automatic acceptance strict while allowing
  // the human result to resolve exactly the ambiguity the queue exposed.
  const humanCinemaOverride = requestedPoiId && cinemaLikeCandidate;
  const humanVenueOverride = verdict === 'same mall/venue only' && requestedPoiId && venueLikeCandidate;
  if (hasLocationConflict || (hardRejects.length > 0 && !(humanCinemaOverride || humanVenueOverride))) throw new Error(`Human accepted candidate has a hard location/type conflict for sourceRow ${queueRecord.sourceRow}.`);
  if (!candidate.location || !Number.isFinite(Number(candidate.location.lat)) || !Number.isFinite(Number(candidate.location.lng))) throw new Error(`Human accepted candidate has no usable coordinate for sourceRow ${queueRecord.sourceRow}.`);
  return candidate;
}

function findAmapCandidateInCache(queueRecord, requestedPoiId) {
  if (!requestedPoiId || !fs.existsSync(AMAP_CACHE_FILE)) return null;
  const cache = readJson(AMAP_CACHE_FILE);
  for (const request of cache.requests ?? []) {
    if (!(request.sourceRows ?? []).some((sourceRow) => Number(sourceRow) === Number(queueRecord.sourceRow))) continue;
    for (const rawCandidate of request.rawCandidates ?? request.candidates ?? []) {
      if (String(rawCandidate?.id ?? '') !== String(requestedPoiId)) continue;
      return normalizeAmapCandidate(rawCandidate, request.query);
    }
  }
  return null;
}

function normalizeHumanCoordinate(providerLat, providerLng, crs, sourceRow, kind) {
  if (!['GCJ-02', 'WGS84', 'BD-09'].includes(crs)) throw new Error(`${kind} human result for sourceRow ${sourceRow} has unsupported CRS: ${crs}`);
  if (crs === 'BD-09') {
    const x = providerLng - 0.0065;
    const y = providerLat - 0.006;
    const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI);
    const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI);
    const gcj = {
      lat: Number((z * Math.sin(theta)).toFixed(7)),
      lng: Number((z * Math.cos(theta)).toFixed(7))
    };
    const converted = gcj02ToWgs84(gcj.lat, gcj.lng);
    return { providerLat: gcj.lat, providerLng: gcj.lng, providerCrs: 'GCJ-02', converted };
  }
  const converted = crs === 'GCJ-02' ? gcj02ToWgs84(providerLat, providerLng) : { lat: providerLat, lng: providerLng };
  return { providerLat, providerLng, providerCrs: crs, converted };
}

function anchorFields(result = {}) {
  const locationAnchorPoiId = String(result.locationAnchorPoiId ?? '').trim() || null;
  const locationAnchorProvider = String(result.locationAnchorProvider ?? '').trim() || null;
  return {
    ...(locationAnchorPoiId ? { locationAnchorPoiId } : {}),
    ...(locationAnchorProvider ? { locationAnchorProvider } : {})
  };
}

function buildHistoricalLocation(result, record) {
  const providerLat = Number(result.lat);
  const providerLng = Number(result.lng);
  const crs = String(result.crs ?? '').trim().toUpperCase();
  const address = String(result.historicalAddress ?? '').trim();
  if (!Number.isFinite(providerLat) || !Number.isFinite(providerLng)) throw new Error(`Historical human result for sourceRow ${record.sourceRow} has invalid coordinates.`);
  if (!address) throw new Error(`Historical human result for sourceRow ${record.sourceRow} has no historicalAddress.`);
  const coordinate = normalizeHumanCoordinate(providerLat, providerLng, crs, record.sourceRow, 'Historical');
  const providerPoiId = result.providerPoiId ?? null;
  const locationAnchor = String(result.locationAnchor ?? result.mallOrVenue ?? '').trim() || null;
  const anchors = anchorFields(result);
  const metadata = {
    name: String(result.name ?? record.name ?? '').trim(),
    historicalAddress: address,
    mallOrVenue: result.mallOrVenue ?? null,
    locationAnchor,
    lat: providerLat,
    lng: providerLng,
    crs,
    providerPoiId,
    providerPoiName: result.providerPoiName ?? null,
    ...anchors,
    granularity: result.granularity ?? 'historical-venue',
    notes: String(result.notes ?? '').trim()
  };
  return {
    location: {
      lat: coordinate.converted.lat,
      lng: coordinate.converted.lng,
      address,
      geocodeConfidence: 'high',
      geocodeSource: 'human:web-historical-location',
      providerLat: coordinate.providerLat,
      providerLng: coordinate.providerLng,
      providerCrs: coordinate.providerCrs,
      mapCrs: 'WGS84',
      positionType: 'venue-poi',
      locationGranularity: 'venue',
      locationConfidence: 'high',
      identityConfidence: 'medium',
      providerPoiId,
      providerPoiName: result.providerPoiName ?? null,
      locationAnchor,
      ...anchors,
      historicalAddress: address,
      previewEvidenceClass: 'human-verified',
      decisionOrigin: 'human-web-verification'
    },
    reviewedCandidate: {
      provider: providerPoiId ? 'amap' : 'human-historical-location',
      providerPoiId,
      poiId: providerPoiId,
      name: metadata.name,
      address,
      mallOrVenue: result.mallOrVenue ?? null,
      locationAnchor,
      ...anchors,
      providerCrs: coordinate.providerCrs,
      providerLat: coordinate.providerLat,
      providerLng: coordinate.providerLng,
      kind: 'venue',
      positionType: 'venue-poi',
      locationGranularity: 'venue'
    },
    metadata
  };
}

function buildExplicitVenueLocation(result, record) {
  const providerLat = Number(result.lat);
  const providerLng = Number(result.lng);
  const address = String(result.address ?? '').trim();
  const crs = String(result.crs ?? 'GCJ-02').trim().toUpperCase();
  if (!Number.isFinite(providerLat) || !Number.isFinite(providerLng) || !address) return null;
  const coordinate = normalizeHumanCoordinate(providerLat, providerLng, crs, record.sourceRow, 'Explicit venue');
  const providerPoiId = result.amapProviderPoiId ?? result.providerPoiId ?? null;
  const providerPoiName = result.providerPoiName ?? null;
  const anchors = anchorFields(result);
  const locationAnchor = String(result.locationAnchorName ?? result.locationAnchor ?? result.mallOrVenue ?? '').trim() || null;
  const name = String(result.name ?? record.name ?? '').trim();
  const mallOrVenue = result.mallOrVenue ?? null;
  const reviewedCandidate = {
    provider: providerPoiId ? 'amap' : 'human-web-venue-location',
    providerPoiId,
    poiId: providerPoiId,
    name,
    address,
    mallOrVenue,
    locationAnchor,
    providerCrs: coordinate.providerCrs,
    providerLat: coordinate.providerLat,
    providerLng: coordinate.providerLng,
    providerPoiName,
    ...anchors,
    kind: 'venue',
    positionType: 'venue-poi',
    locationGranularity: 'venue'
  };
  return {
    location: {
      lat: coordinate.converted.lat,
      lng: coordinate.converted.lng,
      address,
      geocodeConfidence: 'high',
      geocodeSource: 'human:web-venue-location',
      providerLat: coordinate.providerLat,
      providerLng: coordinate.providerLng,
      providerCrs: coordinate.providerCrs,
      mapCrs: 'WGS84',
      positionType: 'venue-poi',
      locationGranularity: 'venue',
      locationConfidence: 'high',
      identityConfidence: 'medium',
      providerPoiId,
      providerPoiName,
      locationAnchor,
      ...anchors,
      previewEvidenceClass: 'human-verified',
      decisionOrigin: 'human-web-verification'
    },
    reviewedCandidate
  };
}

function buildExplicitCinemaLocation(result, record) {
  const providerLat = Number(result.lat);
  const providerLng = Number(result.lng);
  const address = String(result.address ?? '').trim();
  const crs = String(result.crs ?? 'GCJ-02').trim().toUpperCase();
  const providerPoiId = result.amapProviderPoiId ?? result.providerPoiId ?? null;
  if (!providerPoiId || !Number.isFinite(providerLat) || !Number.isFinite(providerLng) || !address) return null;
  const coordinate = normalizeHumanCoordinate(providerLat, providerLng, crs, record.sourceRow, 'Explicit cinema');
  const locationAnchor = String(result.locationAnchorName ?? result.locationAnchor ?? result.mallOrVenue ?? '').trim() || null;
  const anchors = anchorFields(result);
  const name = String(result.name ?? record.name ?? '').trim();
  const mallOrVenue = result.mallOrVenue ?? null;
  const providerPoiName = result.providerPoiName ?? null;
  const reviewedCandidate = {
    provider: 'amap',
    providerPoiId,
    poiId: providerPoiId,
    name,
    address,
    mallOrVenue,
    locationAnchor,
    providerCrs: coordinate.providerCrs,
    providerLat: coordinate.providerLat,
    providerLng: coordinate.providerLng,
    providerPoiName,
    ...anchors,
    kind: 'cinema',
    positionType: 'cinema-poi',
    locationGranularity: 'cinema'
  };
  return {
    location: {
      lat: coordinate.converted.lat,
      lng: coordinate.converted.lng,
      address,
      geocodeConfidence: 'high',
      geocodeSource: 'amap:human-verified-explicit',
      providerLat: coordinate.providerLat,
      providerLng: coordinate.providerLng,
      providerCrs: coordinate.providerCrs,
      mapCrs: 'WGS84',
      positionType: 'cinema-poi',
      locationGranularity: 'cinema',
      locationConfidence: 'high',
      identityConfidence: 'high',
      providerPoiId,
      providerPoiName,
      locationAnchor,
      ...anchors,
      previewEvidenceClass: 'human-verified',
      decisionOrigin: 'human-web-verification'
    },
    reviewedCandidate
  };
}

function buildLocation(candidate, granularity, result = {}) {
  const providerLat = Number(candidate.location.lat);
  const providerLng = Number(candidate.location.lng);
  const converted = gcj02ToWgs84(providerLat, providerLng);
  const locationAnchor = String(result.locationAnchorName ?? result.locationAnchor ?? result.mallOrVenue ?? '').trim() || null;
  const anchors = anchorFields(result);
  return {
    lat: converted.lat,
    lng: converted.lng,
    address: result.address ?? candidate.address ?? '',
    geocodeConfidence: granularity === 'cinema' ? 'high' : 'medium',
    geocodeSource: 'amap:human-verified',
    providerLat,
    providerLng,
    providerCrs: 'GCJ-02',
    mapCrs: 'WGS84',
    positionType: granularity === 'cinema' ? 'cinema-poi' : granularity === 'venue' ? 'venue-poi' : 'mall-fallback',
    locationGranularity: granularity,
    locationConfidence: granularity === 'cinema' ? 'high' : 'medium',
    identityConfidence: granularity === 'cinema' ? 'high' : 'medium',
    providerPoiId: candidate.providerPoiId ?? null,
    locationAnchor,
    ...anchors,
    previewEvidenceClass: 'human-verified',
    decisionOrigin: 'human-web-verification'
  };
}

function inferGranularity(candidate, record) {
  if (candidate.kind === 'venue' || /博物馆|科技馆|科学技术馆|天文馆|科技中心/i.test(record.name)) return 'venue';
  return 'mall';
}

function clearLocation(location) {
  return {
    ...(location ?? {}),
    lat: null,
    lng: null,
    address: '',
    geocodeConfidence: 'unknown',
    geocodeSource: '',
    providerLat: null,
    providerLng: null,
    providerCrs: null,
    mapCrs: null,
    positionType: null,
    locationGranularity: null,
    locationConfidence: 'unknown',
    identityConfidence: 'unknown',
    providerPoiId: null,
    previewEvidenceClass: null,
    decisionOrigin: null
  };
}

function refreshSummary(previous, records, locatedBefore, appliedCount = null) {
  const located = records.filter(hasCoordinate).length;
  const pendingReview = records.filter((record) => record.reviewState === 'pending-review').length;
  const unresolved = records.filter((record) => record.reviewState === 'unresolved').length;
  // A zero-application rerun is used to repair summary metadata after a
  // successful writeback. Preserve that run's original baseline, but use the
  // current preflight count for every real materialization batch.
  const materializationLocatedBefore = appliedCount === 0 && Number.isFinite(Number(previous?.finalMaterialization?.locatedBefore))
    ? Number(previous.finalMaterialization.locatedBefore)
    : locatedBefore;
  const countBy = (values) => Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort());
  return {
    ...(previous ?? {}),
    total: records.length,
    accepted: located,
    markerCount: located,
    located,
    pendingReview,
    unresolved,
    unlocated: pendingReview + unresolved,
    acceptedPlusUnlocated: located + pendingReview + unresolved === records.length ? records.length : null,
    statePartition: located + pendingReview + unresolved === records.length,
    states: { located, unresolved: pendingReview + unresolved },
    reviewVerdicts: countBy(records.map((record) => record.reviewVerdict ?? 'unresolved')),
    finalVerdicts: countBy(records.map((record) => record.finalVerdict ?? (hasCoordinate(record) ? 'located' : 'unresolved'))),
    finalUnresolvedReasons: countBy(records.filter((record) => record.reviewState === 'unresolved').map((record) => record.finalUnresolvedReason ?? 'insufficient-evidence')),
    finalMaterialization: {
      total: records.length,
      locatedBefore: materializationLocatedBefore,
      locatedAfter: located,
      locatedIncrement: located - materializationLocatedBefore,
      finalUnresolved: unresolved,
      pendingReview,
      finalVerdictCounts: countBy(records.map((record) => record.finalVerdict ?? (hasCoordinate(record) ? 'located' : 'unresolved')))
    }
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countBy(values) {
  return Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort());
}

export async function run() {
  const results = readResults();
  if (!results.length) {
    console.log(JSON.stringify({ ok: true, applied: 0, status: 'waiting-for-human-verification-results', resultsFile: path.relative(ROOT, RESULTS_FILE).replaceAll(path.sep, '/') }, null, 2));
    return;
  }
  const canonical = readJson(CANONICAL_FILE);
  const queue = readJson(HUMAN_QUEUE_FILE);
  const baselineLocated = canonical.records.filter(hasCoordinate);
  const beforeCoordinateFingerprint = coordinateFingerprint(baselineLocated);
  const beforeRawFingerprint = rawFingerprint(canonical.records);
  const applied = applyHumanResults({ canonical, queue, results });
  const afterCoordinateFingerprint = coordinateFingerprint(applied.records.filter((record) => baselineLocated.some((before) => before.id === record.id && before.sourceRow === record.sourceRow)));
  const afterRawFingerprint = rawFingerprint(applied.records);
  if (beforeCoordinateFingerprint !== afterCoordinateFingerprint) throw new Error('Human materialization changed an existing approved coordinate.');
  if (beforeRawFingerprint !== afterRawFingerprint) throw new Error('Human materialization changed raw screen/seat fields.');
  canonical.generatedAt = new Date().toISOString();
  canonical.summary = refreshSummary(canonical.summary, applied.records, baselineLocated.length, applied.applied);
  canonical.records = applied.records;
  writeJson(CANONICAL_FILE, canonical);
  queue.generatedAt = new Date().toISOString();
  const resultMap = new Map(results.map((result) => [`${result.id}|${result.sourceRow}`, result]));
  queue.records = queue.records.map((record) => {
    const result = resultMap.get(`${record.id}|${record.sourceRow}`);
    return result ? { ...record, humanVerification: { ...(record.humanVerification ?? {}), ...result, status: 'applied' } } : record;
  });
  queue.summary = {
    ...(queue.summary ?? {}),
    records: queue.records.length,
    humanStatusCounts: countBy(queue.records.map((record) => record.humanVerification?.status ?? 'unverified'))
  };
  queue.scope = {
    ...(queue.scope ?? {}),
    currentLocated: applied.records.filter(hasCoordinate).length,
    currentUnresolved: applied.records.filter((record) => record.reviewState === 'unresolved').length,
    pendingReview: applied.records.filter((record) => record.reviewState === 'pending-review').length
  };
  writeJson(HUMAN_QUEUE_FILE, queue);
  console.log(JSON.stringify({ ok: true, applied: applied.applied, canonical: path.relative(ROOT, CANONICAL_FILE).replaceAll(path.sep, '/'), oldCoordinatePreservation: true, rawIntegrity: true, locatedAfter: applied.records.filter(hasCoordinate).length, unresolvedAfter: applied.records.filter((record) => record.reviewState === 'unresolved').length }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await run();
