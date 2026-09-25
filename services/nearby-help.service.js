const AppError = require("../utils/app-error");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OSRM_ROUTE_ENDPOINT = "https://router.project-osrm.org/route/v1/foot";
const HTTP_HEADERS = {
  Accept: "application/json",
  "User-Agent": "WomenSafetyPlatform-NearbyHelp/1.0",
};
const OVERPASS_RADIUS_METERS = 3000;
const OVERPASS_QUERY_TIMEOUT_SECONDS = 20;
const NEARBY_HELP_CACHE_TTL_MS = 2 * 60 * 1000;
const NEARBY_HELP_STALE_CACHE_TTL_MS = 15 * 60 * 1000;
const nearbyHelpCache = new Map();

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

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min walk`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m walk` : `${hours}h walk`;
};

const estimateWalkingDurationSeconds = (distanceMeters) => {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  return Math.round(distanceMeters / 1.33);
};

const haversineDistanceMeters = (a, b) => {
  const toRadians = (value) => (value * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return Math.round(R * c);
};

const getNavigateUrl = (origin, destination) =>
  `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${origin.latitude}%2C${origin.longitude}%3B${destination.latitude}%2C${destination.longitude}`;

const cacheKeyForOrigin = (origin) => `${origin.latitude.toFixed(3)},${origin.longitude.toFixed(3)}`;

const parseAddress = (tags) => {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
    tags["addr:state"],
  ].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return tags["addr:full"] || "Address unavailable";
};

const fetchJson = async (url, options = {}, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new AppError(response.status, "External map service request failed.", details || undefined);
    }
    return response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(504, "External map service request timed out.");
    }
    throw new AppError(502, "Unable to reach external map service.");
  } finally {
    clearTimeout(timeout);
  }
};

const queryOverpass = async (query) => {
  const providerErrors = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = `${endpoint}?data=${encodeURIComponent(query)}`;
      return await fetchJson(url, {
        method: "GET",
        headers: HTTP_HEADERS,
      }, 30000);
    } catch (error) {
      const statusCode = error instanceof AppError ? error.statusCode : 502;
      const kind =
        statusCode === 429
          ? "rate_limited"
          : statusCode === 504
            ? "timeout"
            : statusCode >= 500
              ? "provider_unavailable"
              : "network_or_query_error";
      providerErrors.push({
        endpoint,
        statusCode,
        kind,
      });
    }
  }
  const hasRateLimit = providerErrors.some((item) => item.kind === "rate_limited");
  const hasTimeout = providerErrors.some((item) => item.kind === "timeout");
  const statusCode = hasRateLimit ? 429 : hasTimeout ? 504 : 502;
  const message = hasRateLimit
    ? "Nearby help providers are rate-limited right now. Please retry in a minute."
    : hasTimeout
      ? "Nearby help providers timed out. Please retry in a moment."
      : "Unable to fetch nearby help places right now. Please try again.";
  throw new AppError(statusCode, message, { providerErrors });
};

const fetchOsrmRoute = async ({ origin, destination, overview = "false" }) => {
  const url = `${OSRM_ROUTE_ENDPOINT}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=${overview}&geometries=polyline&alternatives=false&steps=false`;
  const data = await fetchJson(url, { headers: HTTP_HEADERS }, 12000);
  const route = Array.isArray(data?.routes) ? data.routes[0] : null;
  if (!route) {
    throw new AppError(404, "No walking route found for the selected destination.");
  }
  return route;
};

const fetchNearbyHelpFromOpenData = async (origin) => {
  const query = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];
(
  node["amenity"="police"](around:${OVERPASS_RADIUS_METERS},${origin.latitude},${origin.longitude});
  node["amenity"="hospital"](around:${OVERPASS_RADIUS_METERS},${origin.latitude},${origin.longitude});
);
out body 50;`;

  const data = await queryOverpass(query);
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  const mapped = [];
  const seen = new Set();

  elements.forEach((element) => {
    const tags = element?.tags || {};
    const amenity = tags.amenity;
    if (amenity !== "police" && amenity !== "hospital") return;

    const latitude =
      typeof element?.lat === "number"
        ? element.lat
        : typeof element?.center?.lat === "number"
          ? element.center.lat
          : null;
    const longitude =
      typeof element?.lon === "number"
        ? element.lon
        : typeof element?.center?.lon === "number"
          ? element.center.lon
          : null;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const type = amenity === "police" ? "POLICE" : "HOSPITAL";
    const name = tags.name || (type === "POLICE" ? "Police Station" : "Hospital");
    const key = `${type}:${name}:${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const destination = { latitude, longitude };
    const straightDistanceMeters = haversineDistanceMeters(origin, destination);
    const approxDurationSeconds = estimateWalkingDurationSeconds(straightDistanceMeters);

    mapped.push({
      id: `${type}-${latitude.toFixed(6)}-${longitude.toFixed(6)}`,
      name,
      type,
      address: parseAddress(tags),
      latitude,
      longitude,
      phoneNumber: tags.phone || tags["contact:phone"] || null,
      navigateUrl: getNavigateUrl(origin, destination),
      distanceMeters: straightDistanceMeters,
      walkingDurationSeconds: approxDurationSeconds,
      walkingDurationText: formatDuration(approxDurationSeconds),
    });
  });

  const nearest = mapped.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3);

  const routeSettled = await Promise.allSettled(
    nearest.map((place) =>
      fetchOsrmRoute({
        origin,
        destination: { latitude: place.latitude, longitude: place.longitude },
        overview: "false",
      }),
    ),
  );

  routeSettled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const route = result.value;
    const place = nearest[index];
    if (!place) return;
    if (Number.isFinite(route.distance) && route.distance > 0) {
      place.distanceMeters = Math.round(route.distance);
    }
    if (Number.isFinite(route.duration) && route.duration > 0) {
      place.walkingDurationSeconds = Math.round(route.duration);
      place.walkingDurationText = formatDuration(place.walkingDurationSeconds);
    }
  });

  return nearest;
};

const findNearbyHelp = async ({ latitude, longitude }) => {
  const origin = {
    latitude: parseCoordinate(latitude, "latitude", -90, 90),
    longitude: parseCoordinate(longitude, "longitude", -180, 180),
  };
  const cacheKey = cacheKeyForOrigin(origin);
  const cached = nearbyHelpCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt <= NEARBY_HELP_CACHE_TTL_MS) {
    return cached.places;
  }

  try {
    const places = await fetchNearbyHelpFromOpenData(origin);
    nearbyHelpCache.set(cacheKey, { places, updatedAt: Date.now() });
    return places;
  } catch (error) {
    if (cached && Date.now() - cached.updatedAt <= NEARBY_HELP_STALE_CACHE_TTL_MS) {
      return cached.places;
    }
    throw error;
  }
};

const getRouteToHelp = async ({
  originLatitude,
  originLongitude,
  destinationLatitude,
  destinationLongitude,
  destinationName,
}) => {
  const origin = {
    latitude: parseCoordinate(originLatitude, "originLatitude", -90, 90),
    longitude: parseCoordinate(originLongitude, "originLongitude", -180, 180),
  };
  const destination = {
    latitude: parseCoordinate(destinationLatitude, "destinationLatitude", -90, 90),
    longitude: parseCoordinate(destinationLongitude, "destinationLongitude", -180, 180),
  };

  const route = await fetchOsrmRoute({ origin, destination, overview: "full" });

  const durationSeconds = Number.isFinite(route.duration) ? Math.round(route.duration) : null;
  const distanceMeters = Number.isFinite(route.distance) ? Math.round(route.distance) : null;

  return {
    destinationName: destinationName?.trim() || "Selected destination",
    distanceMeters,
    walkingDurationSeconds: durationSeconds,
    walkingDurationText: formatDuration(durationSeconds),
    encodedPolyline: typeof route.geometry === "string" ? route.geometry : null,
    navigateUrl: getNavigateUrl(origin, destination),
  };
};

module.exports = {
  findNearbyHelp,
  getRouteToHelp,
};
