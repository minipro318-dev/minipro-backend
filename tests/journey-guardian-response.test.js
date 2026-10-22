const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/minidb?schema=public";
}

const prisma = require("../lib/prisma");
const AppError = require("../utils/app-error");
const {
  PREDEFINED_GUARDIAN_MESSAGES,
  sendGuardianResponse,
  listGuardianResponses,
} = require("../services/journey.service");

const originalJourney = prisma.journey;
const originalGuardianLink = prisma.guardianLink;
const originalGuardianJourneyResponse = prisma.guardianJourneyResponse;
const originalTransaction = prisma.$transaction;

test.afterEach(() => {
  prisma.journey = originalJourney;
  prisma.guardianLink = originalGuardianLink;
  prisma.guardianJourneyResponse = originalGuardianJourneyResponse;
  prisma.$transaction = originalTransaction;
});

test("sendGuardianResponse rejects non-guardian role", async () => {
  await assert.rejects(
    () =>
      sendGuardianResponse({
        journeyId: 10,
        userId: 1,
        role: "END_USER",
        messageTemplateKey: "ON_MY_WAY",
      }),
    (error) => error instanceof AppError && error.statusCode === 403,
  );
});

test("sendGuardianResponse rejects guardian not linked to end user", async () => {
  prisma.journey = {
    findUnique: async () => ({ id: 10, plannedById: 77, status: "ESCALATED", escalationIncidentId: 9 }),
  };
  prisma.guardianLink = { findFirst: async () => null };

  await assert.rejects(
    () =>
      sendGuardianResponse({
        journeyId: 10,
        userId: 2,
        role: "GUARDIAN",
        messageTemplateKey: "ON_MY_WAY",
      }),
    (error) => error instanceof AppError && error.statusCode === 403,
  );
});

test("sendGuardianResponse persists predefined response and audit event", async () => {
  const recorded = {
    responseInput: null,
    eventInput: null,
  };

  prisma.journey = {
    findUnique: async () => ({ id: 10, plannedById: 77, status: "ESCALATED", escalationIncidentId: 9 }),
  };
  prisma.guardianLink = {
    findFirst: async () => ({ id: 1 }),
  };
  prisma.$transaction = async (callback) =>
    callback({
      guardianJourneyResponse: {
        create: async ({ data }) => {
          recorded.responseInput = data;
          return {
            id: 45,
            ...data,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            guardian: { id: 2, name: "Guardian One", email: "guardian@example.com", role: "GUARDIAN" },
          };
        },
      },
      journeyEvent: {
        create: async ({ data }) => {
          recorded.eventInput = data;
          return { id: 99, ...data };
        },
      },
    });

  const response = await sendGuardianResponse({
    journeyId: 10,
    userId: 2,
    role: "GUARDIAN",
    messageTemplateKey: "ON_MY_WAY",
  });

  assert.equal(response.id, 45);
  assert.equal(recorded.responseInput.messageTemplateKey, "ON_MY_WAY");
  assert.equal(recorded.responseInput.message, PREDEFINED_GUARDIAN_MESSAGES.ON_MY_WAY);
  assert.equal(recorded.eventInput.eventType, "GUARDIAN_RESPONSE_SENT");
  assert.equal(recorded.eventInput.actorRole, "GUARDIAN");
});

test("listGuardianResponses enforces guardian link access", async () => {
  prisma.journey = {
    findUnique: async () => ({ id: 10, plannedById: 77 }),
  };
  prisma.guardianLink = {
    findFirst: async () => null,
  };

  await assert.rejects(
    () => listGuardianResponses({ journeyId: 10, userId: 2, role: "GUARDIAN" }),
    (error) => error instanceof AppError && error.statusCode === 403,
  );
});
