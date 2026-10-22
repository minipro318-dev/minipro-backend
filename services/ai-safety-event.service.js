const { AiSafetyEventStatus, IncidentStatus, UserRole } = require("@prisma/client");
const prisma = require("../lib/prisma");
const AppError = require("../utils/app-error");

const CONFIRMATION_WINDOW_SECONDS = Math.max(20, Number(process.env.AI_SAFETY_CONFIRMATION_TIMEOUT_SECONDS || 45));
const MAX_HISTORY_ITEMS = Math.max(20, Math.min(300, Number(process.env.AI_SAFETY_HISTORY_LIMIT || 100)));

const aiEventInclude = {
  user: {
    select: { id: true, name: true, email: true, mobile: true, role: true },
  },
  linkedIncident: {
    include: {
      reportedBy: {
        select: { id: true, name: true, email: true, mobile: true, role: true },
      },
      resolvedBy: {
        select: { id: true, name: true, email: true, role: true },
      },
      locationLogs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  },
};

const parseCoordinate = (value, name, min, max, isOptional) => {
  if (isOptional && (value === undefined || value === null || value === "")) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError(400, `${name} must be a valid number.`);
  }
  if (parsed < min || parsed > max) {
    throw new AppError(400, `${name} must be between ${min} and ${max}.`);
  }
  return parsed;
};

const parseOptionalNumber = (value, fieldName, min, max) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError(400, `${fieldName} must be a valid number.`);
  }
  if (parsed < min || parsed > max) {
    throw new AppError(400, `${fieldName} must be between ${min} and ${max}.`);
  }
  return parsed;
};

const parseOptionalString = (value, fieldName, maxLength) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AppError(400, `${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AppError(400, `${fieldName} must be at most ${maxLength} characters.`);
  }
  return trimmed;
};

const parseDetectedAt = (value) => {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "detectedAt must be a valid ISO datetime.");
  }
  return parsed;
};

const getAccessibleEvent = async ({ eventId, userId, role }) => {
  const event = await prisma.aiSafetyEvent.findUnique({
    where: { id: eventId },
    include: aiEventInclude,
  });

  if (!event) {
    throw new AppError(404, "AI safety event not found.");
  }

  if (role === UserRole.ADMIN) {
    return event;
  }

  if (role === UserRole.END_USER && event.userId === userId) {
    return event;
  }

  if (role === UserRole.GUARDIAN) {
    const linked = await prisma.guardianLink.findFirst({
      where: { guardianId: userId, endUserId: event.userId },
      select: { id: true },
    });
    if (linked) {
      return event;
    }
  }

  throw new AppError(403, "You do not have access to this AI safety event.");
};

const createDetectionEvent = async ({ userId, role, payload }) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can create AI safety detections.");
  }

  const existingPending = await prisma.aiSafetyEvent.findFirst({
    where: {
      userId,
      status: {
        in: [AiSafetyEventStatus.DETECTED, AiSafetyEventStatus.AWAITING_CONFIRMATION],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  if (existingPending && Date.now() - new Date(existingPending.createdAt).getTime() < 60000) {
    throw new AppError(409, `A pending AI safety confirmation already exists (#${existingPending.id}).`);
  }

  const latitude = parseCoordinate(payload.latitude, "latitude", -90, 90, true);
  const longitude = parseCoordinate(payload.longitude, "longitude", -180, 180, true);
  const accuracy = parseOptionalNumber(payload.accuracy, "accuracy", 0, 10000);
  const confidence = parseOptionalNumber(payload.classifierConfidence, "classifierConfidence", 0, 1);
  const score = parseOptionalNumber(payload.classifierScore, "classifierScore", 0, 100);
  const detectedAt = parseDetectedAt(payload.detectedAt);
  const eventType = parseOptionalString(payload.eventType, "eventType", 40) || "POSSIBLE_FALL";
  const modelProvider = parseOptionalString(payload.modelProvider, "modelProvider", 80) || "local";
  const modelVersion = parseOptionalString(payload.modelVersion, "modelVersion", 80) || "v1";
  const classifierType = parseOptionalString(payload.classifierType, "classifierType", 80) || "POSE_HEURISTIC";
  const confidenceLabel = parseOptionalString(payload.confidenceLabel, "confidenceLabel", 50);
  const locationAddress = parseOptionalString(payload.locationAddress, "locationAddress", 200);
  const deadline = new Date(Date.now() + CONFIRMATION_WINDOW_SECONDS * 1000);

  const event = await prisma.aiSafetyEvent.create({
    data: {
      userId,
      eventType,
      status: AiSafetyEventStatus.AWAITING_CONFIRMATION,
      detectedAt,
      modelProvider,
      modelVersion,
      classifierType,
      classifierScore: score,
      classifierConfidence: confidence,
      confidenceLabel,
      lastKnownLatitude: latitude,
      lastKnownLongitude: longitude,
      lastKnownAccuracy: accuracy,
      lastKnownAddress: locationAddress,
      confirmationDeadline: deadline,
      escalationReason: null,
    },
    include: aiEventInclude,
  });

  return event;
};

const listEventsByRole = async ({ userId, role, status, limit }) => {
  const where = {};
  const parsedLimit = Math.max(1, Math.min(MAX_HISTORY_ITEMS, Number(limit) || MAX_HISTORY_ITEMS));

  if (status) {
    const normalized = String(status).trim().toUpperCase();
    if (!Object.values(AiSafetyEventStatus).includes(normalized)) {
      throw new AppError(400, "Invalid AI safety event status filter.");
    }
    where.status = normalized;
  }

  if (role === UserRole.ADMIN) {
    return prisma.aiSafetyEvent.findMany({
      where,
      include: aiEventInclude,
      orderBy: { detectedAt: "desc" },
      take: parsedLimit,
    });
  }

  if (role === UserRole.END_USER) {
    return prisma.aiSafetyEvent.findMany({
      where: { ...where, userId },
      include: aiEventInclude,
      orderBy: { detectedAt: "desc" },
      take: parsedLimit,
    });
  }

  if (role === UserRole.GUARDIAN) {
    const links = await prisma.guardianLink.findMany({
      where: { guardianId: userId },
      select: { endUserId: true },
    });
    const endUserIds = links.map((item) => item.endUserId);
    if (!endUserIds.length) return [];

    return prisma.aiSafetyEvent.findMany({
      where: { ...where, userId: { in: endUserIds } },
      include: aiEventInclude,
      orderBy: { detectedAt: "desc" },
      take: parsedLimit,
    });
  }

  throw new AppError(403, "Unsupported role for AI safety event listing.");
};

const respondToEvent = async ({ eventId, userId, role, action, reason }) => {
  const event = await getAccessibleEvent({ eventId, userId, role });
  const actorCanRespond = role === UserRole.ADMIN || (role === UserRole.END_USER && event.userId === userId);
  if (!actorCanRespond) {
    throw new AppError(403, "Only the end user or admin can update this AI safety event.");
  }
  if (event.status === AiSafetyEventStatus.ESCALATED || event.status === AiSafetyEventStatus.CANCELLED) {
    throw new AppError(409, "This AI safety event cannot be updated in its current state.");
  }

  const parsedReason = parseOptionalString(reason, "reason", 250);
  const now = new Date();

  if (action === "ACKNOWLEDGE") {
    return prisma.aiSafetyEvent.update({
      where: { id: event.id },
      data: {
        status: AiSafetyEventStatus.ACKNOWLEDGED,
        userResponse: "I_AM_SAFE",
        responseReason: parsedReason,
        respondedAt: now,
        confirmationDeadline: null,
      },
      include: aiEventInclude,
    });
  }

  if (action === "FALSE_ALARM") {
    return prisma.aiSafetyEvent.update({
      where: { id: event.id },
      data: {
        status: AiSafetyEventStatus.FALSE_ALARM,
        userResponse: "FALSE_ALARM",
        responseReason: parsedReason,
        respondedAt: now,
        confirmationDeadline: null,
      },
      include: aiEventInclude,
    });
  }

  throw new AppError(400, "Unsupported AI safety action.");
};

const listPendingEscalations = async () =>
  prisma.aiSafetyEvent.findMany({
    where: {
      status: AiSafetyEventStatus.AWAITING_CONFIRMATION,
      confirmationDeadline: { lte: new Date() },
    },
    include: aiEventInclude,
    orderBy: { confirmationDeadline: "asc" },
    take: 100,
  });

const ensureEscalationIncident = async (event) => {
  if (event.linkedIncidentId) {
    const existing = await prisma.incident.findUnique({
      where: { id: event.linkedIncidentId },
      include: {
        reportedBy: { select: { id: true, name: true, email: true, mobile: true, role: true } },
        resolvedBy: { select: { id: true, name: true, email: true, role: true } },
        locationLogs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (existing) {
      return existing;
    }
  }

  const activeIncident = await prisma.incident.findFirst({
    where: { reportedById: event.userId, status: IncidentStatus.ACTIVE },
    include: {
      reportedBy: { select: { id: true, name: true, email: true, mobile: true, role: true } },
      resolvedBy: { select: { id: true, name: true, email: true, role: true } },
      locationLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (activeIncident) {
    return activeIncident;
  }

  return prisma.incident.create({
    data: {
      title: "AI Safety Escalation",
      description: `AI safety event #${event.id} escalated.`,
      reportedById: event.userId,
      status: IncidentStatus.ACTIVE,
      locationLogs:
        Number.isFinite(event.lastKnownLatitude) && Number.isFinite(event.lastKnownLongitude)
          ? {
              create: {
                latitude: event.lastKnownLatitude,
                longitude: event.lastKnownLongitude,
                accuracy: Number.isFinite(event.lastKnownAccuracy) ? event.lastKnownAccuracy : null,
                locationTimestamp: event.detectedAt || new Date(),
                address: event.lastKnownAddress || null,
                source: "AI_ESCALATION",
                createdById: event.userId,
              },
            }
          : undefined,
    },
    include: {
      reportedBy: { select: { id: true, name: true, email: true, mobile: true, role: true } },
      resolvedBy: { select: { id: true, name: true, email: true, role: true } },
      locationLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
};

const escalateEventWithIncident = async ({ eventId, escalatedById, escalationReason, userResponse, responseReason }) => {
  const event = await prisma.aiSafetyEvent.findUnique({
    where: { id: eventId },
    include: aiEventInclude,
  });
  if (!event) {
    throw new AppError(404, "AI safety event not found.");
  }
  if (event.status === AiSafetyEventStatus.ESCALATED && event.linkedIncidentId) {
    const incident = await prisma.incident.findUnique({
      where: { id: event.linkedIncidentId },
      include: {
        reportedBy: { select: { id: true, name: true, email: true, mobile: true, role: true } },
        resolvedBy: { select: { id: true, name: true, email: true, role: true } },
        locationLogs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return { event, incident };
  }

  const incident = await ensureEscalationIncident(event);
  const updatedEvent = await prisma.aiSafetyEvent.update({
    where: { id: event.id },
    data: {
      status: AiSafetyEventStatus.ESCALATED,
      userResponse: userResponse || "NO_RESPONSE",
      responseReason: responseReason || null,
      respondedAt: new Date(),
      confirmationDeadline: null,
      escalationReason: escalationReason || "AI safety escalation triggered.",
      escalatedAt: new Date(),
      linkedIncidentId: incident.id,
      escalatedById: Number.isInteger(escalatedById) ? escalatedById : null,
    },
    include: aiEventInclude,
  });

  return { event: updatedEvent, incident };
};

const markEscalatedByTimeout = async ({ eventId, incidentId, escalatedById, escalationReason }) =>
  prisma.aiSafetyEvent.update({
    where: { id: eventId },
    data: {
      status: AiSafetyEventStatus.ESCALATED,
      userResponse: "NO_RESPONSE",
      respondedAt: new Date(),
      confirmationDeadline: null,
      escalationReason: escalationReason || "No safety confirmation received before timeout.",
      escalatedAt: new Date(),
      linkedIncidentId: incidentId || undefined,
      escalatedById: Number.isInteger(escalatedById) ? escalatedById : null,
    },
    include: aiEventInclude,
  });

const getAdminOverview = async () => {
  const [total, pending, escalated, falseAlarms] = await Promise.all([
    prisma.aiSafetyEvent.count(),
    prisma.aiSafetyEvent.count({ where: { status: AiSafetyEventStatus.AWAITING_CONFIRMATION } }),
    prisma.aiSafetyEvent.count({ where: { status: AiSafetyEventStatus.ESCALATED } }),
    prisma.aiSafetyEvent.count({ where: { status: AiSafetyEventStatus.FALSE_ALARM } }),
  ]);

  return { total, pending, escalated, falseAlarms };
};

module.exports = {
  CONFIRMATION_WINDOW_SECONDS,
  createDetectionEvent,
  listEventsByRole,
  getAccessibleEvent,
  respondToEvent,
  listPendingEscalations,
  markEscalatedByTimeout,
  escalateEventWithIncident,
  getAdminOverview,
  __test: {
    parseCoordinate,
    parseOptionalNumber,
    parseOptionalString,
    parseDetectedAt,
  },
};
