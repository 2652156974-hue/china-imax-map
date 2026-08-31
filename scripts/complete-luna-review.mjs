import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT_FILE = path.join(ROOT, 'data/local/luna-geocode-review-323.json');
const OUTPUT_FILE = path.join(ROOT, 'data/local/luna-geocode-review-323.completed.json');
const SUMMARY_FILE = path.join(ROOT, 'data/audit/luna-geocode-review-323-summary.json');

export const ALLOWED_VERDICTS = new Set([
  'accept-exact',
  'accept-location-only',
  'reject-wrong-poi',
  'ambiguous',
  'not-found',
  'needs-more-evidence'
]);

const ACCEPTED_VERDICTS = new Set(['accept-exact', 'accept-location-only']);
const VALID_POSITION_TYPES = new Set(['cinema-poi', 'venue-poi', 'mall-fallback']);
const VALID_GRANULARITIES = new Set(['auditorium', 'cinema', 'venue', 'mall']);
const VALID_LOCATION_CONFIDENCE = new Set(['high', 'medium']);
const VALID_IDENTITY_CONFIDENCE = new Set(['high', 'medium', 'low']);
const PROVIDER_HOSTS = new Set(['amap.com', 'autonavi.com', 'gaode.com']);

export function completeLunaReview({
  inputFile = INPUT_FILE,
  outputFile = OUTPUT_FILE,
  summaryFile = SUMMARY_FILE,
  reviewedAt = new Date().toISOString()
} = {}) {
  const input = readJson(inputFile);
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new Error('Expected a non-empty Luna review package.');
  }
  const sourceRows = input.records.map((record) => Number(record.sourceRow));
  if (sourceRows.some((sourceRow) => !Number.isInteger(sourceRow)) || new Set(sourceRows).size !== sourceRows.length) {
    throw new Error('Luna review package sourceRow values must be unique integers.');
  }

  const records = input.records.map((record) => ({
    ...record,
    review: normalizeReview(record.review, { reviewedAt, recordContext: record })
  }));
  const verdicts = countBy(records, (record) => record.review.verdict);
  const validationErrors = countBy(
    records.flatMap((record) => record.review.validationErrors ?? []),
    (value) => value
  );
  const recordsWithExplicitVerdict = records.filter((record) => record.review.explicitVerdict).length;
  const recordsAutoFilledNeedsMoreEvidence = records.filter(
    (record) => record.review.reviewSource === 'unreviewed-default'
  ).length;
  const recordsDowngradedFromInvalidAccept = records.filter(
    (record) => record.review.reviewSource === 'invalid-accept-downgraded'
  ).length;
  const reviewComplete = records.every((record) =>
    record.review.explicitVerdict && record.review.reviewSource !== 'invalid-accept-downgraded'
  );
  const generatedAt = new Date().toISOString();
  const summary = {
    schemaVersion: 2,
    generatedAt,
    status: reviewComplete ? 'validated-row-level-review' : 'validated-with-unreviewed-rows',
    reviewComplete,
    evidenceBounded: true,
    total: records.length,
    verdicts,
    recordsWithExplicitVerdict,
    recordsAutoFilledNeedsMoreEvidence,
    recordsDowngradedFromInvalidAccept,
    recordsWithScreenSeatContext: records.filter(hasScreenSeatContext).length,
    recordsWithAcceptedCoordinates: records.filter((record) => isAcceptedReview(record.review, record)).length,
    reviewerMode: 'Strict validator/normalizer. Empty rows remain explicitly unreviewed and never become accepted coordinates.',
    publicSummarySafe: true,
    validationErrors,
    notes: [
      '本摘要只报告数量和 reason tags，不复制 provider response、候选数组、坐标或凭据。',
      '空 review 只规范化为 needs-more-evidence 的未审核状态，不代表逐条人工审核完成。',
      'accept verdict 必须同时具备合法 AMap GCJ-02 reviewedCandidate、位置/身份双置信度、粒度、reviewer、时间和独立公开证据 URL。'
    ],
    reasonTags: countBy(records.flatMap((record) => record.reasonTags ?? []), (value) => value)
  };

  const output = {
    ...input,
    generatedAt,
    status: summary.status,
    reviewValidation: {
      schemaVersion: 2,
      reviewComplete,
      evidenceBounded: true,
      recordsWithExplicitVerdict,
      recordsAutoFilledNeedsMoreEvidence,
      recordsDowngradedFromInvalidAccept
    },
    records
  };
  writeJson(outputFile, output);
  writeJson(summaryFile, summary);
  return {
    outputFile,
    summaryFile,
    total: records.length,
    reviewComplete,
    recordsWithExplicitVerdict,
    recordsAutoFilledNeedsMoreEvidence,
    recordsDowngradedFromInvalidAccept,
    accepted: summary.recordsWithAcceptedCoordinates,
    verdicts
  };
}

export function normalizeReview(review, { reviewedAt = new Date().toISOString(), recordContext = null } = {}) {
  const source = review && typeof review === 'object' ? review : {};
  const requestedVerdict = typeof source.verdict === 'string' ? source.verdict.trim() : '';
  const explicitVerdict = ALLOWED_VERDICTS.has(requestedVerdict) && (
    source.explicitVerdict === true ||
    (source.explicitVerdict === undefined && requestedVerdict !== 'needs-more-evidence')
  );
  const evidenceUrls = normalizeEvidenceUrls(source.evidenceUrls);
  const reviewer = nonEmptyString(source.reviewer);
  const normalizedReviewedAt = validDate(source.reviewedAt) ? new Date(source.reviewedAt).toISOString() : null;
  const base = {
    verdict: explicitVerdict ? requestedVerdict : 'needs-more-evidence',
    acceptedPoiId: null,
    reviewedCandidate: emptyCandidate(),
    positionType: null,
    locationGranularity: null,
    locationConfidence: null,
    identityConfidence: null,
    evidenceUrls,
    administrativeBinding: normalizeAdministrativeBinding(source.administrativeBinding),
    reviewer,
    reviewedAt: normalizedReviewedAt,
    notes: nonEmptyString(source.notes) ?? '',
    explicitVerdict,
    reviewSource: explicitVerdict ? 'explicit-row-review' : 'unreviewed-default',
    validationErrors: []
  };

  if (!explicitVerdict) {
    return {
      ...base,
      evidenceUrls: [],
      reviewer: null,
      reviewedAt: null,
      notes: base.notes || '未提供逐条 review；保留 needs-more-evidence，尚未完成证据审核。'
    };
  }

  if (!ACCEPTED_VERDICTS.has(requestedVerdict)) {
    return base;
  }

  const validation = validateAcceptedReview(source, requestedVerdict, recordContext);
  if (validation.errors.length) {
    return {
      ...base,
      verdict: 'needs-more-evidence',
      evidenceUrls,
      reviewSource: 'invalid-accept-downgraded',
      validationErrors: validation.errors,
      notes: appendNote(
        base.notes,
        `原 accept verdict 未通过严格校验，已降级为 needs-more-evidence：${validation.errors.join('；')}`
      )
    };
  }

  const candidate = sanitizeReviewedCandidate(source.reviewedCandidate);
  return {
    ...base,
    verdict: requestedVerdict,
    acceptedPoiId: candidate.poiId,
    reviewedCandidate: candidate,
    positionType: source.positionType,
    locationGranularity: source.locationGranularity,
    locationConfidence: source.locationConfidence,
    identityConfidence: source.identityConfidence,
    evidenceUrls,
    administrativeBinding: normalizeAdministrativeBinding(source.administrativeBinding),
    reviewer,
    reviewedAt: normalizedReviewedAt,
    reviewSource: 'validated-row-review'
  };
}

export function validateAcceptedReview(review, verdict, recordContext = null) {
  const errors = [];
  const candidate = review?.reviewedCandidate;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    errors.push('accepted candidate missing');
  } else {
    if (String(candidate.provider ?? '').toLowerCase() !== 'amap') errors.push('candidate provider must be amap');
    if (!nonEmptyString(candidate.poiId)) errors.push('candidate poiId missing');
    if (candidate.providerCrs !== 'GCJ-02') errors.push('candidate providerCrs must be GCJ-02');
    if (!validLatitude(candidate.providerLat)) errors.push('candidate providerLat is not a legal latitude');
    if (!validLongitude(candidate.providerLng)) errors.push('candidate providerLng is not a legal longitude');
  }
  if (!nonEmptyString(review?.acceptedPoiId)) {
    errors.push('acceptedPoiId is required');
  } else if (candidate && review.acceptedPoiId !== candidate.poiId) {
    errors.push('acceptedPoiId must equal reviewedCandidate.poiId');
  }
  if (!VALID_POSITION_TYPES.has(String(review?.positionType ?? ''))) errors.push('positionType missing or invalid');
  if (!VALID_GRANULARITIES.has(String(review?.locationGranularity ?? ''))) errors.push('locationGranularity missing or invalid');
  if (!VALID_LOCATION_CONFIDENCE.has(String(review?.locationConfidence ?? ''))) errors.push('locationConfidence must be high or medium');
  if (!VALID_IDENTITY_CONFIDENCE.has(String(review?.identityConfidence ?? ''))) errors.push('identityConfidence missing or invalid');
  if (verdict === 'accept-exact') {
    if (!['auditorium', 'cinema'].includes(review?.locationGranularity)) errors.push('accept-exact requires auditorium or cinema granularity');
    if (review?.positionType !== 'cinema-poi') errors.push('accept-exact requires cinema-poi positionType');
    if (review?.identityConfidence !== 'high') errors.push('accept-exact requires high identityConfidence');
  }
  if (verdict === 'accept-location-only') {
    if (!['venue', 'mall'].includes(review?.locationGranularity)) errors.push('accept-location-only requires venue or mall granularity');
    if (!['venue-poi', 'mall-fallback'].includes(review?.positionType)) errors.push('accept-location-only requires venue-poi or mall-fallback positionType');
    if (!['medium', 'low'].includes(review?.identityConfidence)) errors.push('accept-location-only requires medium or low identityConfidence');
  }
  const urls = normalizeEvidenceUrls(review?.evidenceUrls);
  if (!urls.some(isIndependentEvidenceUrl)) errors.push('at least one independent evidence URL is required');
  if (!nonEmptyString(review?.reviewer)) errors.push('reviewer is required');
  if (!validDate(review?.reviewedAt)) errors.push('reviewedAt must be a valid timestamp');
  errors.push(...validateRecordContext(review, recordContext));
  return { ok: errors.length === 0, errors };
}

export function isAcceptedReview(review, recordContext = null) {
  if (!ACCEPTED_VERDICTS.has(review?.verdict)) return false;
  return validateAcceptedReview(review, review.verdict, recordContext).ok;
}

function validateRecordContext(review, recordContext) {
  if (!recordContext) return [];
  const errors = [];
  const reviewContext = recordContext.reviewContext && typeof recordContext.reviewContext === 'object'
    ? recordContext.reviewContext
    : {};
  if (!Number.isInteger(Number(recordContext.sourceRow))) {
    errors.push('record context sourceRow is missing');
  }

  const candidate = review?.reviewedCandidate;
  const cachedCandidates = [
    ...(Array.isArray(recordContext.cachedCandidates) ? recordContext.cachedCandidates : []),
    ...(Array.isArray(recordContext.cacheCandidates) ? recordContext.cacheCandidates : []),
    ...(Array.isArray(recordContext.alternateCandidates) ? recordContext.alternateCandidates : []),
    ...(Array.isArray(reviewContext.cachedCandidates) ? reviewContext.cachedCandidates : []),
    ...(Array.isArray(reviewContext.cacheCandidates) ? reviewContext.cacheCandidates : []),
    ...(Array.isArray(reviewContext.alternateCandidates) ? reviewContext.alternateCandidates : []),
    recordContext.candidate,
    recordContext.cachedCandidate,
    recordContext.parentVenue,
    reviewContext.candidate,
    reviewContext.cachedCandidate,
    reviewContext.parentVenue
  ].filter((item) => item && typeof item === 'object' && nonEmptyString(item.poiId));
  const allowedPoiIds = new Set(cachedCandidates.map((item) => nonEmptyString(item.poiId)));
  for (const item of Array.isArray(recordContext.parentVenues) ? recordContext.parentVenues : []) {
    if (item && typeof item === 'object' && nonEmptyString(item.poiId)) allowedPoiIds.add(nonEmptyString(item.poiId));
  }
  if (allowedPoiIds.size === 0) {
    errors.push('sourceRow cache candidate context is missing');
    return errors;
  }
  if (!candidate || !allowedPoiIds.has(nonEmptyString(candidate.poiId))) {
    errors.push('reviewedCandidate.poiId is not bound to this sourceRow cache candidate or explicit parent venue');
  }
  const disallowedPoiIds = new Set([
    ...(Array.isArray(recordContext.disallowedPoiIds) ? recordContext.disallowedPoiIds : []),
    ...(Array.isArray(reviewContext.disallowedPoiIds) ? reviewContext.disallowedPoiIds : [])
  ].map((value) => nonEmptyString(value)).filter(Boolean));
  if (candidate && disallowedPoiIds.has(nonEmptyString(candidate.poiId))) {
    errors.push('reviewedCandidate.poiId is explicitly disallowed for this sourceRow');
  }

  const boundCandidate = cachedCandidates.find((item) => item.poiId === candidate?.poiId) ?? cachedCandidates[0];
  if (!boundCandidate) return errors;
  if (boundCandidate.adminMatch?.compatible === false) {
    errors.push('sourceRow cache candidate has incompatible administrative match');
  }
  if (recordContext.province && boundCandidate.pname && !sameAdministrativeName(recordContext.province, boundCandidate.pname)) {
    errors.push('candidate province is not bound to sourceRow province');
  }
  if (recordContext.city && !candidateMatchesCity(recordContext, boundCandidate)) {
    errors.push('candidate city is not bound to sourceRow city');
  }
  if (isUnboundCountyCandidate(recordContext, boundCandidate)) {
    const administrativeBinding = validateAdministrativeBinding(
      review?.administrativeBinding,
      boundCandidate,
      review?.evidenceUrls,
      recordContext
    );
    if (!administrativeBinding.ok) {
      errors.push('county-level candidate is not bound to the sourceRow location and may be a same-prefecture duplicate');
      errors.push(...administrativeBinding.errors);
    }
  }
  if (candidate && boundCandidate.name && !relatedText(candidate.name, boundCandidate.name)) {
    errors.push('reviewedCandidate name/project does not match sourceRow cache candidate');
  }
  if (candidate && boundCandidate.address && candidate.address && !relatedText(candidate.address, boundCandidate.address)) {
    errors.push('reviewedCandidate address does not match sourceRow cache candidate');
  }
  if (boundCandidate.formatCompatibility?.compatible === false) {
    errors.push('sourceRow cache candidate is format-incompatible');
  }
  if (review?.positionType !== boundCandidate.positionType) {
    errors.push('positionType is not bound to sourceRow cache candidate');
  }
  if (!granularityCompatibleWithCache(review, boundCandidate)) {
    errors.push('locationGranularity is not bound to sourceRow cache candidate');
  }
  if (recordContext.projection?.dome === true && boundCandidate.formatCompatibility?.compatible !== true) {
    errors.push('dome source requires a format-compatible cache candidate');
  }
  if (recordContext.sourceName && !sourceNameMatchesCandidate(recordContext, boundCandidate)) {
    errors.push('candidate name/project is not traceable to sourceRow name or former name');
  }
  return errors;
}

function candidateMatchesCity(recordContext, candidate) {
  const sourceCity = normalizeAdminName(recordContext.city);
  const values = [candidate.cityname, candidate.adname, candidate.adminMatch?.targetPrefecture, candidate.adminMatch?.targetCounty, candidate.adminMatch?.providerPrefecture, candidate.adminMatch?.providerCounty]
    .filter(Boolean)
    .map(normalizeAdminName);
  return values.includes(sourceCity);
}

function granularityCompatibleWithCache(review, candidate) {
  if (review?.locationGranularity === candidate?.locationGranularity) return true;
  // A typecode-080601 cinema POI can be reviewed conservatively as the whole
  // cinema even when an older matcher snapshot labelled it auditorium. This
  // is a precision downgrade, not an identity upgrade or a matcher change.
  return review?.positionType === 'cinema-poi' &&
    candidate?.positionType === 'cinema-poi' &&
    review?.locationGranularity === 'cinema' &&
    candidate?.locationGranularity === 'auditorium';
}

function isUnboundCountyCandidate(recordContext, candidate) {
  if (recordContext.countyLevelCity !== false) return false;
  if (recordContext.ambiguity?.trueAmbiguity !== true) return false;
  if (!candidate.cityname || !candidate.adname || !sameAdministrativeName(recordContext.city, candidate.cityname)) return false;
  if (sameAdministrativeName(recordContext.city, candidate.adname)) return false;
  const candidateCounty = comparableText(candidate.adname);
  const candidateIdentityText = comparableText([candidate.name, candidate.address].filter(Boolean).join(' '));
  const sourceText = comparableText([recordContext.sourceName, ...(Array.isArray(recordContext.formerNames) ? recordContext.formerNames : [])].filter(Boolean).join(' '));
  return candidateCounty.length >= 2 && candidateIdentityText.includes(candidateCounty) && !sourceText.includes(candidateCounty);
}

function validateAdministrativeBinding(binding, candidate, reviewEvidenceUrls, recordContext) {
  const errors = [];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { ok: false, errors };
  }
  if (binding.status !== 'confirmed-by-independent-evidence') {
    errors.push('administrative binding status is not independently confirmed');
  }
  if (Number(binding.sourceRow) !== Number(recordContext.sourceRow)) {
    errors.push('administrative binding sourceRow does not match record context');
  }
  if (!sameAdministrativeName(binding.sourceCity, recordContext.city)) {
    errors.push('administrative binding source city does not match record context');
  }
  if (!sameAdministrativeName(binding.candidateCity, candidate.cityname)) {
    errors.push('administrative binding candidate city does not match cache candidate');
  }
  if (!sameAdministrativeName(binding.candidateAdministrativeUnit, candidate.adname)) {
    errors.push('administrative binding administrative unit does not match cache candidate');
  }
  const bindingUrls = normalizeEvidenceUrls(binding.evidenceUrls);
  const reviewUrls = normalizeEvidenceUrls(reviewEvidenceUrls);
  if (!bindingUrls.some(isIndependentEvidenceUrl)) {
    errors.push('administrative binding requires an independent evidence URL');
  }
  if (!bindingUrls.some((url) => reviewUrls.includes(url))) {
    errors.push('administrative binding evidence must be listed in evidenceUrls');
  }
  return { ok: errors.length === 0, errors };
}

function sourceNameMatchesCandidate(recordContext, candidate) {
  const sourceNames = [recordContext.sourceName, ...(Array.isArray(recordContext.formerNames) ? recordContext.formerNames : [])].filter(Boolean);
  const candidateTexts = [candidate.name, candidate.address].filter(Boolean);
  return sourceNames.some((sourceName) => candidateTexts.some((candidateText) => relatedText(sourceName, candidateText)));
}

function sameAdministrativeName(left, right) {
  return normalizeAdminName(left) === normalizeAdminName(right);
}

function normalizeAdminName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s\u00a0]/g, '')
    .replace(/[省市州地区盟]$/u, '')
    .toLowerCase();
}

function relatedText(left, right) {
  const a = comparableText(left);
  const b = comparableText(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aBigrams = new Set([...a].map((_, index) => a.slice(index, index + 2)).filter((value) => value.length === 2));
  const sharedBigrams = [...new Set([...b].map((_, index) => b.slice(index, index + 2)).filter((value) => value.length === 2))]
    .filter((value) => aBigrams.has(value));
  return sharedBigrams.length >= 2;
}

function comparableText(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\s\u00a0，。、“”‘’'"()（）【】\[\]{}<>《》：:；;、/\\|_-]/g, '').toLowerCase();
}

function sanitizeReviewedCandidate(candidate) {
  return {
    provider: 'amap',
    poiId: nonEmptyString(candidate.poiId),
    name: nonEmptyString(candidate.name),
    address: nonEmptyString(candidate.address),
    providerCrs: 'GCJ-02',
    providerLat: Number(candidate.providerLat),
    providerLng: Number(candidate.providerLng)
  };
}

function emptyCandidate() {
  return {
    provider: null,
    poiId: null,
    name: null,
    address: null,
    providerCrs: null,
    providerLat: null,
    providerLng: null
  };
}

function normalizeEvidenceUrls(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter((url) => isHttpUrl(url)))];
}

function normalizeAdministrativeBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    status: nonEmptyString(value.status),
    sourceRow: Number.isInteger(Number(value.sourceRow)) ? Number(value.sourceRow) : null,
    sourceCity: nonEmptyString(value.sourceCity),
    candidateCity: nonEmptyString(value.candidateCity),
    candidateAdministrativeUnit: nonEmptyString(value.candidateAdministrativeUnit),
    evidenceUrls: normalizeEvidenceUrls(value.evidenceUrls)
  };
}

function isIndependentEvidenceUrl(url) {
  if (!isHttpUrl(url)) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return ![...PROVIDER_HOSTS].some((providerHost) => hostname === providerHost || hostname.endsWith(`.${providerHost}`));
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function validDate(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(new Date(value).getTime());
}

function validLatitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -90 && number <= 90;
}

function validLongitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -180 && number <= 180;
}

function nonEmptyString(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function appendNote(existing, addition) {
  return [existing, addition].filter(Boolean).join(existing ? ' ' : '');
}

function hasScreenSeatContext(record) {
  return typeof record.screen?.rawWidth === 'string' &&
    typeof record.screen?.rawHeight === 'string' &&
    typeof record.screen?.rawArea === 'string' &&
    typeof record.seatsRaw === 'string';
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = String(keyFn(record) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = completeLunaReview();
  console.log(JSON.stringify({
    ok: true,
    output: path.relative(ROOT, result.outputFile).replaceAll(path.sep, '/'),
    summary: path.relative(ROOT, result.summaryFile).replaceAll(path.sep, '/'),
    total: result.total,
    reviewComplete: result.reviewComplete,
    explicitVerdicts: result.recordsWithExplicitVerdict,
    autoFilledNeedsMoreEvidence: result.recordsAutoFilledNeedsMoreEvidence,
    downgradedInvalidAccepts: result.recordsDowngradedFromInvalidAccept,
    accepted: result.accepted,
    verdicts: result.verdicts
  }, null, 2));
}
