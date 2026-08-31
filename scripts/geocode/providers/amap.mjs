const ENDPOINT = 'https://restapi.amap.com/v3/place/text';
const SENSITIVE_KEY = /^(key|api[_-]?key|token|access[_-]?token|secret)$/i;

function redact(value, secret) {
  if (Array.isArray(value)) return value.map((item) => redact(item, secret));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      output[key] = redact(item, secret);
    }
    return output;
  }
  if (typeof value === 'string' && secret) return value.split(secret).join('[redacted]');
  return value;
}

function safeErrorMessage(error, secret) {
  const message = error instanceof Error ? error.message : String(error);
  return secret ? message.split(secret).join('[redacted]') : message;
}

export const providerName = 'amap';

export function availability() {
  const key = process.env.AMAP_API_KEY;
  return key
    ? { available: true, provider: providerName }
    : { available: false, provider: providerName, reason: 'AMAP_API_KEY is not set in the process environment' };
}

/**
 * Official AMap Web Service keyword POI search.
 * The key is read at call time and is never returned to callers or persisted.
 */
export async function searchPlace({ query, city, offset = 25, page = 1, extensions = 'all', fetchImpl = globalThis.fetch }) {
  const key = process.env.AMAP_API_KEY;
  if (!key) return { ok: false, available: false, provider: providerName, errorCode: 'missing-key', errorMessage: 'AMAP_API_KEY is not set in the process environment' };
  if (typeof fetchImpl !== 'function') return { ok: false, available: true, provider: providerName, errorCode: 'fetch-unavailable', errorMessage: 'No fetch implementation is available' };

  const params = new URLSearchParams({
    key,
    keywords: query,
    city,
    citylimit: 'true',
    offset: String(Math.min(Math.max(offset, 1), 25)),
    page: String(Math.max(page, 1)),
    extensions,
    output: 'JSON'
  });

  try {
    const response = await fetchImpl(`${ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' }
    });
    const body = await response.json();
    const safeBody = redact(body, key);
    if (!response.ok) {
      return {
        ok: false,
        available: true,
        provider: providerName,
        query,
        city,
        errorCode: `http-${response.status}`,
        errorMessage: `AMap HTTP status ${response.status}`,
        rawMeta: safeBody
      };
    }
    if (String(body?.status) !== '1') {
      return {
        ok: false,
        available: true,
        provider: providerName,
        query,
        city,
        errorCode: 'api-error',
        errorMessage: typeof body?.info === 'string' ? safeErrorMessage(body.info, key) : 'AMap returned a non-success status',
        rawMeta: safeBody
      };
    }
    return {
      ok: true,
      available: true,
      provider: providerName,
      query,
      city,
      fetchedAt: new Date().toISOString(),
      candidates: Array.isArray(body?.pois) ? safeBody.pois : [],
      rawMeta: {
        status: safeBody.status,
        info: safeBody.info,
        count: safeBody.count,
        infocode: safeBody.infocode
      }
    };
  } catch (error) {
    return {
      ok: false,
      available: true,
      provider: providerName,
      query,
      city,
      errorCode: 'network-error',
      errorMessage: safeErrorMessage(error, key)
    };
  }
}

