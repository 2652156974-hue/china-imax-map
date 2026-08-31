export const providerName = 'nominatim';
export const endpoint = 'https://nominatim.openstreetmap.org/search';

export function availability({ scope = 'mainland' } = {}) {
  if (scope !== 'regional') {
    return {
      available: false,
      provider: providerName,
      reason: 'Nominatim is a regional fallback and is not the primary mainland provider'
    };
  }
  return {
    available: true,
    provider: providerName,
    scope,
    providerCrs: 'WGS84',
    rateLimit: 'single-threaded, no more than one request per second',
    attribution: '© OpenStreetMap contributors, ODbL'
  };
}

export async function searchPlace({
  query,
  city = '',
  limit = 10,
  fetchImpl = globalThis.fetch,
  userAgent = 'china-imax-map/0.1 (+https://github.com/2652156974-hue/china-imax-map)',
  timeoutMs = 15000
} = {}) {
  if (!query) {
    return { ok: false, available: true, provider: providerName, errorCode: 'missing-query' };
  }
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      available: true,
      provider: providerName,
      errorCode: 'fetch-unavailable',
      errorMessage: 'No fetch implementation is available'
    };
  }

  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(Math.max(1, Math.min(50, limit))));
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('dedupe', '1');
  url.searchParams.set('accept-language', 'zh-TW,zh;q=0.9,en;q=0.8');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'User-Agent': userAgent
      },
      ...(controller ? { signal: controller.signal } : {})
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        available: true,
        provider: providerName,
        query,
        city,
        statusCode: response.status,
        errorCode: 'http-error',
        errorMessage: text.slice(0, 300)
      };
    }
    let rawCandidates;
    try {
      rawCandidates = JSON.parse(text);
    } catch {
      return {
        ok: false,
        available: true,
        provider: providerName,
        query,
        city,
        errorCode: 'invalid-json'
      };
    }
    return {
      ok: Array.isArray(rawCandidates),
      available: true,
      provider: providerName,
      query,
      city,
      providerCrs: 'WGS84',
      requestUrl: url.toString(),
      rawCandidates: Array.isArray(rawCandidates) ? rawCandidates : []
    };
  } catch (error) {
    return {
      ok: false,
      available: true,
      provider: providerName,
      query,
      city,
      errorCode: error?.name === 'AbortError' ? 'network-timeout' : 'network-error',
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
