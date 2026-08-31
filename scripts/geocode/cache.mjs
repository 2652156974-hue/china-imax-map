import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY = /^(key|api[_-]?key|token|access[_-]?token|secret)$/i;

export function cacheKey(provider, query, city) {
  return [provider, query, city].map((value) => String(value ?? '').trim()).join('|');
}

export function blankProviderCache(provider) {
  return {
    schemaVersion: 1,
    provider,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    requests: []
  };
}

export function loadProviderCache(filePath, provider) {
  if (!fs.existsSync(filePath)) return blankProviderCache(provider);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return { ...blankProviderCache(provider), requests: parsed };
    if (!parsed || typeof parsed !== 'object') return blankProviderCache(provider);
    return {
      ...blankProviderCache(provider),
      ...parsed,
      provider,
      requests: Array.isArray(parsed.requests) ? parsed.requests : []
    };
  } catch (error) {
    throw new Error(`Cannot read provider cache ${filePath}: ${error.message}`);
  }
}

export function findCachedRequest(cache, provider, query, city) {
  const wanted = cacheKey(provider, query, city);
  return cache.requests.find((entry) => entry.cacheKey === wanted)
    ?? cache.requests.find((entry) => entry.provider === provider && entry.query === query && entry.city === city);
}

export function upsertCachedRequest(cache, entry) {
  const next = { ...entry, cacheKey: entry.cacheKey ?? cacheKey(entry.provider, entry.query, entry.city) };
  const index = cache.requests.findIndex((item) => item.cacheKey === next.cacheKey);
  if (index === -1) cache.requests.push(next);
  else cache.requests[index] = next;
  cache.updatedAt = new Date().toISOString();
}

export function writeProviderCache(filePath, cache) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const safe = redact(cache);
  fs.writeFileSync(filePath, `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      output[key] = redact(item);
    }
    return output;
  }
  return value;
}

