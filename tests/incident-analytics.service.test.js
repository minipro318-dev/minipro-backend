const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/minidb?schema=public";
}

const AppError = require("../utils/app-error");
const { __test } = require("../services/incident-analytics.service");

test("parseFilters defaults values for valid request", () => {
  const filters = __test.parseFilters({});
  assert.equal(filters.timeOfDay, "ALL");
  assert.ok(Array.isArray(filters.statuses));
  assert.equal(filters.timezone, "UTC");
  assert.ok(filters.endDate > filters.startDate);
});

test("parseFilters rejects invalid date range", () => {
  assert.throws(
    () =>
      __test.parseFilters({
        startDate: "2026-10-22",
        endDate: "2025-10-22",
      }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test("parseStatuses accepts csv and rejects unsupported values", () => {
  const values = __test.parseStatuses("active,resolved");
  assert.deepEqual(values.sort(), ["ACTIVE", "RESOLVED"]);

  assert.throws(
    () => __test.parseStatuses("UNKNOWN"),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test("parseBounds validates coordinate ranges", () => {
  const bounds = __test.parseBounds({
    minLat: "12.9",
    maxLat: "13.2",
    minLng: "77.4",
    maxLng: "77.8",
  });
  assert.equal(bounds.minLat, 12.9);

  assert.throws(
    () =>
      __test.parseBounds({
        minLat: "-91",
        maxLat: "10",
        minLng: "77",
        maxLng: "78",
      }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test("resolveGranularity auto-selects by range", () => {
  const start = new Date("2026-10-01T00:00:00.000Z");
  const end = new Date("2026-10-02T00:00:00.000Z");
  assert.equal(__test.resolveGranularity(start, end), "hour");
});

test("csvEscape quotes comma and quote correctly", () => {
  assert.equal(__test.csvEscape('A "quoted" area, zone'), '"A ""quoted"" area, zone"');
});
