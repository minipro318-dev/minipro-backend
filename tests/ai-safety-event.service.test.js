const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "******localhost:5432/minidb?schema=public";
}

const AppError = require("../utils/app-error");
const { __test } = require("../services/ai-safety-event.service");

test("parseCoordinate supports optional null values", () => {
  const value = __test.parseCoordinate(undefined, "latitude", -90, 90, true);
  assert.equal(value, null);
});

test("parseCoordinate validates range", () => {
  assert.throws(
    () => __test.parseCoordinate("120", "latitude", -90, 90, false),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test("parseOptionalNumber validates and parses values", () => {
  assert.equal(__test.parseOptionalNumber("0.84", "classifierConfidence", 0, 1), 0.84);
  assert.throws(
    () => __test.parseOptionalNumber("2.5", "classifierConfidence", 0, 1),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test("parseOptionalString trims empty and enforces max length", () => {
  assert.equal(__test.parseOptionalString("   ", "reason", 50), null);
  assert.equal(__test.parseOptionalString(" okay ", "reason", 50), "okay");
  assert.throws(
    () => __test.parseOptionalString("x".repeat(80), "reason", 50),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test("parseDetectedAt rejects invalid datetime", () => {
  assert.throws(
    () => __test.parseDetectedAt("not-a-date"),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});
