const PI = Math.PI;
const AXIS = 6378245.0;
const ECCENTRICITY_SQUARED = 0.00669342162296594323;

function outsideChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  result += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  result += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  return result;
}

function transformLng(x, y) {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  result += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  result += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  return result;
}

export function gcj02ToWgs84(providerLat, providerLng) {
  const lat = Number(providerLat);
  const lng = Number(providerLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (outsideChina(lat, lng)) return { lat, lng };
  let deltaLat = transformLat(lng - 105, lat - 35);
  let deltaLng = transformLng(lng - 105, lat - 35);
  const radians = lat / 180 * PI;
  let magic = Math.sin(radians);
  magic = 1 - ECCENTRICITY_SQUARED * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  deltaLat = deltaLat * 180 / ((AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * sqrtMagic) * PI);
  deltaLng = deltaLng * 180 / (AXIS / sqrtMagic * Math.cos(radians) * PI);
  return {
    lat: Number((lat * 2 - (lat + deltaLat)).toFixed(7)),
    lng: Number((lng * 2 - (lng + deltaLng)).toFixed(7))
  };
}

export function amapCoordinate(candidate) {
  const [providerLng, providerLat] = String(candidate?.location ?? '').split(',').map(Number);
  if (!Number.isFinite(providerLng) || !Number.isFinite(providerLat) || providerLng < 70 || providerLng > 140 || providerLat < 0 || providerLat > 60) return null;
  const converted = gcj02ToWgs84(providerLat, providerLng);
  return {
    providerLat,
    providerLng,
    providerCrs: 'GCJ-02',
    lat: converted.lat,
    lng: converted.lng,
    mapCrs: 'WGS84'
  };
}
