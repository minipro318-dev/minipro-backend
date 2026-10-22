const AppError = require("./app-error");

const USER_AGENT = "women-safety-platform/1.0";
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const REVERSE_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_MIN_QUERY_LENGTH = 3;
const SEARCH_MAX_QUERY_LENGTH = 120;

const searchCache = new Map();
const reverseCache = new Map();

const parseCoordinate = (value, name, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError(400, `${name} must be a valid number.`);
  }
  if (parsed < min || parsed > max) {
    throw new AppError(400, `${name} must be between ${min} and ${max}.`);
  }
  return parsed;
};

const fetchJson = async (url, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new AppError(429, "Geocoding provider is rate-limited. Please retry shortly.");
      }
      if (response.status >= 500) {
        throw new AppError(503, "Geocoding provider is currently unavailable.");
      }
      throw new AppError(502, "Geocoding request failed.");
    }

    return response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(504, "Geocoding provider timed out.");
    }
    throw new AppError(502, "Unable to reach geocoding provider.");
  } finally {
    clearTimeout(timeout);
  }
};

const trimCache = (cache, ttlMs) => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.updatedAt > ttlMs) {
      cache.delete(key);
    }
  }
};

const searchAddresses = async ({ query, limit = 5 }) => {
  if (typeof query !== "string") {
    throw new AppError(400, "query is required.");
  }
  const normalized = query.trim();
  if (normalized.length < SEARCH_MIN_QUERY_LENGTH) {
    throw new AppError(400, `query must be at least ${SEARCH_MIN_QUERY_LENGTH} characters.`);
  }
  if (normalized.length > SEARCH_MAX_QUERY_LENGTH) {
    throw new AppError(400, `query must be at most ${SEARCH_MAX_QUERY_LENGTH} characters.`);
  }

  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 5));
  const cacheKey = `${normalized.toLowerCase()}::${safeLimit}`;

  trimCache(searchCache, SEARCH_CACHE_TTL_MS);
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt <= SEARCH_CACHE_TTL_MS) {
    return cached.results;
  }

  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("q", normalized);
  endpoint.searchParams.set("limit", String(safeLimit));
  endpoint.searchParams.set("addressdetails", "1");

  const payload = await fetchJson(endpoint, 12000);
  const list = Array.isArray(payload) ? payload : [];
  const results = list
    .map((item) => {
      const latitude = Number(item?.lat);
      const longitude = Number(item?.lon);
      const displayName =
        typeof item?.display_name === "string" && item.display_name.trim()
          ? item.display_name.trim()
          : null;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !displayName) {
        return null;
      }
      return {
        placeId: String(item?.place_id || `${latitude}:${longitude}`),
        displayName,
        latitude,
        longitude,
      };
    })
    .filter(Boolean);

  searchCache.set(cacheKey, { updatedAt: Date.now(), results });
  return results;
};

const reverseGeocodeAddress = async ({ latitude, longitude }) => {
  const parsedLatitude = parseCoordinate(latitude, "latitude", -90, 90);
  const parsedLongitude = parseCoordinate(longitude, "longitude", -180, 180);
  const cacheKey = `${parsedLatitude.toFixed(5)},${parsedLongitude.toFixed(5)}`;

  trimCache(reverseCache, REVERSE_CACHE_TTL_MS);
  const cached = reverseCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt <= REVERSE_CACHE_TTL_MS) {
    return cached.result;
  }

  const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
  endpoint.searchParams.set("lat", String(parsedLatitude));
  endpoint.searchParams.set("lon", String(parsedLongitude));
  endpoint.searchParams.set("format", "jsonv2");

  const payload = await fetchJson(endpoint, 12000);
  const displayName =
    typeof payload?.display_name === "string" && payload.display_name.trim()
      ? payload.display_name.trim()
      : null;

  const result = {
    displayName,
    latitude: parsedLatitude,
    longitude: parsedLongitude,
  };
  reverseCache.set(cacheKey, { updatedAt: Date.now(), result });
  return result;
};

module.exports = { searchAddresses, reverseGeocodeAddress };
