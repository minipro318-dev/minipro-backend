const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateDeviationSample } = require("../services/journey-evaluation");

const encodePolyline = (points) => {
  const encodeValue = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    chunk += String.fromCharCode(v + 63);
    return chunk;
  };

  let previousLat = 0;
  let previousLon = 0;
  let output = "";

  for (const point of points) {
    const lat = Math.round(point.latitude * 1e5);
    const lon = Math.round(point.longitude * 1e5);
    output += encodeValue(lat - previousLat);
    output += encodeValue(lon - previousLon);
    previousLat = lat;
    previousLon = lon;
  }

  return output;
};

const routePolyline = encodePolyline([
  { latitude: 12.9716, longitude: 77.5946 },
  { latitude: 12.9816, longitude: 77.5946 },
]);

test("evaluateDeviationSample skips non-active status", () => {
  const result = evaluateDeviationSample({
    status: "CHECK_IN_REQUIRED",
    routePolyline,
    previousOffRouteCount: 2,
    latitude: 12.9816,
    longitude: 77.5946,
    accuracy: 10,
    thresholdMeters: 120,
    requiredCount: 3,
    maxAccuracyMeters: 100,
  });

  assert.equal(result.shouldEvaluate, false);
  assert.equal(result.shouldTriggerCheckIn, false);
  assert.equal(result.nextOffRouteCount, 0);
});

test("evaluateDeviationSample triggers check-in after consecutive off-route readings", () => {
  const result = evaluateDeviationSample({
    status: "ACTIVE",
    routePolyline,
    previousOffRouteCount: 2,
    latitude: 12.9816,
    longitude: 77.6026,
    accuracy: 12,
    thresholdMeters: 120,
    requiredCount: 3,
    maxAccuracyMeters: 100,
  });

  assert.equal(result.shouldEvaluate, true);
  assert.equal(result.isOffRoute, true);
  assert.equal(result.nextOffRouteCount, 3);
  assert.equal(result.shouldTriggerCheckIn, true);
  assert.ok((result.routeDeviationMeters || 0) > 120);
});

test("evaluateDeviationSample resets consecutive count when back on-route", () => {
  const result = evaluateDeviationSample({
    status: "ACTIVE",
    routePolyline,
    previousOffRouteCount: 2,
    latitude: 12.9766,
    longitude: 77.59461,
    accuracy: 8,
    thresholdMeters: 120,
    requiredCount: 3,
    maxAccuracyMeters: 100,
  });

  assert.equal(result.shouldEvaluate, true);
  assert.equal(result.isOffRoute, false);
  assert.equal(result.nextOffRouteCount, 0);
  assert.equal(result.shouldTriggerCheckIn, false);
});
