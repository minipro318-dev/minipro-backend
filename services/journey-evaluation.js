const EARTH_RADIUS_METERS = 6371000;

const decodePolyline = (encoded) => {
  if (!encoded || typeof encoded !== "string") return [];

  let index = 0;
  let lat = 0;
  let lon = 0;
  const points = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length + 1);
    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length + 1);
    const deltaLon = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lon += deltaLon;

    points.push({ latitude: lat / 1e5, longitude: lon / 1e5 });
  }

  return points;
};

const projectToMeters = (coordinate, referenceLatitude) => {
  const latRad = (coordinate.latitude * Math.PI) / 180;
  const lonRad = (coordinate.longitude * Math.PI) / 180;
  const refLatRad = (referenceLatitude * Math.PI) / 180;
  return {
    x: EARTH_RADIUS_METERS * lonRad * Math.cos(refLatRad),
    y: EARTH_RADIUS_METERS * latRad,
  };
};

const distancePointToSegmentMeters = (point, start, end, referenceLatitude) => {
  const p = projectToMeters(point, referenceLatitude);
  const a = projectToMeters(start, referenceLatitude);
  const b = projectToMeters(end, referenceLatitude);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  return Math.sqrt(dx * dx + dy * dy);
};

const minimumDistanceToRouteMeters = (point, routePoints) => {
  if (!routePoints || routePoints.length < 2) return null;
  let minDistance = Number.POSITIVE_INFINITY;
  const referenceLatitude = point.latitude;

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const distance = distancePointToSegmentMeters(point, routePoints[index], routePoints[index + 1], referenceLatitude);
    if (distance < minDistance) minDistance = distance;
  }

  return Number.isFinite(minDistance) ? Math.round(minDistance) : null;
};

const evaluateDeviationSample = ({
  status,
  routePolyline,
  previousOffRouteCount,
  latitude,
  longitude,
  accuracy,
  thresholdMeters,
  requiredCount,
  maxAccuracyMeters,
}) => {
  const routePoints = decodePolyline(routePolyline);
  const shouldEvaluate =
    status === "ACTIVE" &&
    routePoints.length > 1 &&
    (accuracy === null || accuracy <= maxAccuracyMeters);

  if (!shouldEvaluate) {
    return {
      shouldEvaluate: false,
      routeDeviationMeters: null,
      isOffRoute: false,
      nextOffRouteCount: 0,
      shouldTriggerCheckIn: false,
    };
  }

  const routeDeviationMeters = minimumDistanceToRouteMeters({ latitude, longitude }, routePoints);
  const isOffRoute = Number.isFinite(routeDeviationMeters) && routeDeviationMeters > thresholdMeters;
  const nextOffRouteCount = isOffRoute ? previousOffRouteCount + 1 : 0;

  return {
    shouldEvaluate: true,
    routeDeviationMeters,
    isOffRoute,
    nextOffRouteCount,
    shouldTriggerCheckIn: isOffRoute && nextOffRouteCount >= requiredCount,
  };
};

module.exports = { decodePolyline, minimumDistanceToRouteMeters, evaluateDeviationSample };
