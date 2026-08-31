export const providerName = 'tencent';

export function availability() {
  return {
    available: false,
    provider: providerName,
    reason: 'Tencent POI adapter is reserved for a later explicitly configured phase'
  };
}

export async function searchPlace() {
  return {
    ok: false,
    available: false,
    provider: providerName,
    errorCode: 'not-configured',
    errorMessage: 'Tencent POI adapter is not enabled in this phase'
  };
}

