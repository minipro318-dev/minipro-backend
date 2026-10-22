const { JourneyEventType, JourneyStatus, UserRole } = require("@prisma/client");
const prisma = require("../lib/prisma");
const AppError = require("../utils/app-error");
const nearbyHelpService = require("./nearby-help.service");
const { reverseGeocode } = require("../utils/reverse-geocode");
const { searchAddresses, reverseGeocodeAddress } = require("../utils/nominatim");
const { evaluateDeviationSample } = require("./journey-evaluation");

const DEVIATION_THRESHOLD_METERS = Math.max(30, Number(process.env.JOURNEY_DEVIATION_THRESHOLD_METERS || 120));
const DEVIATION_REQUIRED_COUNT = Math.max(2, Number(process.env.JOURNEY_DEVIATION_REQUIRED_COUNT || 3));
const MAX_ACCURACY_FOR_DEVIATION_METERS = Math.max(20, Number(process.env.JOURNEY_MAX_ACCURACY_FOR_DEVIATION_METERS || 100));
const CHECK_IN_TIMEOUT_SECONDS = Math.max(30, Number(process.env.JOURNEY_CHECK_IN_TIMEOUT_SECONDS || 120));
const GUARDIAN_RESPONSE_MAX_LENGTH = 400;
const PREDEFINED_GUARDIAN_MESSAGES = {
  ON_MY_WAY: "I'm on my way.",
  CHECKING_LOCATION: "I've received your alert and am checking your location.",
  CONTACTING_TRUSTED_HELP: "I'm contacting another trusted person to help.",
  STAY_SAFE_COORDINATING: "Please stay somewhere safe if possible. I'm coordinating assistance.",
  ARRANGING_HELP: "I cannot reach you yet, but I'm arranging help.",
};

const journeyListInclude = {
  plannedBy: {
    select: { id: true, name: true, email: true, mobile: true, role: true },
  },
  escalationIncident: {
    select: { id: true, status: true, createdAt: true },
  },
  locations: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  events: {
    orderBy: { createdAt: "desc" },
    take: 15,
  },
  guardianResponses: {
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      guardian: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  },
};

const journeyDetailInclude = {
  plannedBy: {
    select: { id: true, name: true, email: true, mobile: true, role: true },
  },
  escalationIncident: {
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
  locations: {
    orderBy: { createdAt: "desc" },
    take: 200,
  },
  events: {
    orderBy: { createdAt: "desc" },
    take: 200,
  },
  guardianResponses: {
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      guardian: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  },
};

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

const parseAccuracy = (accuracy) => {
  if (accuracy === undefined || accuracy === null || accuracy === "") {
    return null;
  }
  const parsed = Number(accuracy);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(400, "accuracy must be a valid number greater than or equal to 0.");
  }
  return parsed;
};

const parseLocationTimestamp = (locationTimestamp) => {
  if (!locationTimestamp) return new Date();
  const parsed = new Date(locationTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "locationTimestamp must be a valid ISO datetime.");
  }
  return parsed;
};

const parseOptionalTitle = (title) => {
  if (title === undefined || title === null || title === "") return "Safe Journey";
  if (typeof title !== "string") throw new AppError(400, "title must be a string.");
  const trimmed = title.trim();
  if (!trimmed) return "Safe Journey";
  if (trimmed.length > 120) throw new AppError(400, "title must be at most 120 characters.");
  return trimmed;
};

const parseDestinationName = (destinationName) => {
  if (!destinationName || typeof destinationName !== "string" || !destinationName.trim()) {
    throw new AppError(400, "destinationName is required.");
  }
  const trimmed = destinationName.trim();
  if (trimmed.length > 160) throw new AppError(400, "destinationName must be at most 160 characters.");
  return trimmed;
};

const parseReason = (reason) => {
  if (!reason) return null;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed ? trimmed.slice(0, 250) : null;
};

const parseGuardianResponseMessage = ({ messageTemplateKey, customMessage }) => {
  const key = typeof messageTemplateKey === "string" ? messageTemplateKey.trim() : "";
  const custom = typeof customMessage === "string" ? customMessage.trim() : "";

  if (!key && !custom) {
    throw new AppError(400, "Provide a predefined message or customMessage.");
  }

  if (key) {
    const predefined = PREDEFINED_GUARDIAN_MESSAGES[key];
    if (!predefined) {
      throw new AppError(400, "Invalid messageTemplateKey.");
    }
    if (custom) {
      throw new AppError(400, "customMessage must be empty when using predefined messageTemplateKey.");
    }
    return { message: predefined, messageTemplateKey: key };
  }

  if (!custom) {
    throw new AppError(400, "customMessage cannot be empty.");
  }
  if (custom.length > GUARDIAN_RESPONSE_MAX_LENGTH) {
    throw new AppError(400, `customMessage must be at most ${GUARDIAN_RESPONSE_MAX_LENGTH} characters.`);
  }

  return { message: custom, messageTemplateKey: null };
};

const createJourneyEvent = async ({ tx, journeyId, eventType, message, actorRole, actorId, metadata }) =>
  tx.journeyEvent.create({
    data: {
      journeyId,
      eventType,
      message,
      actorRole: actorRole || null,
      actorId: Number.isInteger(actorId) ? actorId : null,
      metadata: metadata || undefined,
    },
  });

const searchDestinationSuggestions = async ({ role, query, limit }) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can search journey destinations.");
  }
  return searchAddresses({ query, limit });
};

const reverseDestinationFromCoordinates = async ({ role, latitude, longitude }) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can reverse-geocode journey destinations.");
  }
  return reverseGeocodeAddress({
    latitude: parseCoordinate(latitude, "latitude", -90, 90),
    longitude: parseCoordinate(longitude, "longitude", -180, 180),
  });
};

const assertJourneyAccessible = async ({ journey, userId, role }) => {
  if (role === UserRole.ADMIN) return;

  if (role === UserRole.END_USER && journey.plannedById === userId) {
    return;
  }

  if (role === UserRole.GUARDIAN) {
    const linked = await prisma.guardianLink.findFirst({
      where: { guardianId: userId, endUserId: journey.plannedById },
      select: { id: true },
    });
    if (linked) return;
  }

  throw new AppError(403, "You do not have access to this journey.");
};

const ensureJourneyOwnerOrAdmin = ({ journey, userId, role }) => {
  if (role === UserRole.ADMIN) return;
  if (role === UserRole.END_USER && journey.plannedById === userId) return;
  throw new AppError(403, "You do not have permission to update this journey.");
};

const previewJourney = async ({
  role,
  originLatitude,
  originLongitude,
  destinationLatitude,
  destinationLongitude,
  destinationName,
}) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can preview safe journeys.");
  }

  const parsedDestinationName = parseDestinationName(destinationName);
  const route = await nearbyHelpService.getRouteToHelp({
    originLatitude: parseCoordinate(originLatitude, "originLatitude", -90, 90),
    originLongitude: parseCoordinate(originLongitude, "originLongitude", -180, 180),
    destinationLatitude: parseCoordinate(destinationLatitude, "destinationLatitude", -90, 90),
    destinationLongitude: parseCoordinate(destinationLongitude, "destinationLongitude", -180, 180),
    destinationName: parsedDestinationName,
  });

  return route;
};

const startJourney = async ({
  userId,
  role,
  title,
  originLatitude,
  originLongitude,
  destinationLatitude,
  destinationLongitude,
  destinationName,
  accuracy,
  locationTimestamp,
  address,
}) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can start safe journeys.");
  }

  const existingActive = await prisma.journey.findFirst({
    where: {
      plannedById: userId,
      status: { in: [JourneyStatus.ACTIVE, JourneyStatus.CHECK_IN_REQUIRED, JourneyStatus.ESCALATED] },
    },
    select: { id: true },
  });
  if (existingActive) {
    throw new AppError(409, `An active safe journey already exists (#${existingActive.id}).`);
  }

  const parsedTitle = parseOptionalTitle(title);
  const parsedDestinationName = parseDestinationName(destinationName);
  const parsedOriginLatitude = parseCoordinate(originLatitude, "originLatitude", -90, 90);
  const parsedOriginLongitude = parseCoordinate(originLongitude, "originLongitude", -180, 180);
  const parsedDestinationLatitude = parseCoordinate(destinationLatitude, "destinationLatitude", -90, 90);
  const parsedDestinationLongitude = parseCoordinate(destinationLongitude, "destinationLongitude", -180, 180);
  const parsedAccuracy = parseAccuracy(accuracy);
  const parsedLocationTimestamp = parseLocationTimestamp(locationTimestamp);

  const route = await nearbyHelpService.getRouteToHelp({
    originLatitude: parsedOriginLatitude,
    originLongitude: parsedOriginLongitude,
    destinationLatitude: parsedDestinationLatitude,
    destinationLongitude: parsedDestinationLongitude,
    destinationName: parsedDestinationName,
  });

  const routeDurationSeconds = Number.isFinite(route.walkingDurationSeconds) ? route.walkingDurationSeconds : null;
  const expectedArrivalAt =
    Number.isInteger(routeDurationSeconds) && routeDurationSeconds > 0
      ? new Date(Date.now() + routeDurationSeconds * 1000)
      : null;

  const resolvedAddress =
    address?.trim() ||
    (await reverseGeocode({
      latitude: parsedOriginLatitude,
      longitude: parsedOriginLongitude,
    }));

  const journey = await prisma.$transaction(async (tx) => {
    const createdJourney = await tx.journey.create({
      data: {
        title: parsedTitle,
        destinationName: parsedDestinationName,
        destinationLatitude: parsedDestinationLatitude,
        destinationLongitude: parsedDestinationLongitude,
        status: JourneyStatus.ACTIVE,
        plannedById: userId,
        startedAt: new Date(),
        expectedArrivalAt,
        routePolyline: route.encodedPolyline || null,
        routeDistanceMeters: Number.isFinite(route.distanceMeters) ? route.distanceMeters : null,
        routeDurationSeconds,
        currentLatitude: parsedOriginLatitude,
        currentLongitude: parsedOriginLongitude,
        currentAccuracy: parsedAccuracy,
        currentAddress: resolvedAddress || null,
        currentLocationAt: parsedLocationTimestamp,
      },
    });

    await tx.journeyLocation.create({
      data: {
        journeyId: createdJourney.id,
        latitude: parsedOriginLatitude,
        longitude: parsedOriginLongitude,
        accuracy: parsedAccuracy,
        address: resolvedAddress || null,
        locationTimestamp: parsedLocationTimestamp,
        source: "JOURNEY_START",
      },
    });

    await createJourneyEvent({
      tx,
      journeyId: createdJourney.id,
      eventType: JourneyEventType.JOURNEY_CREATED,
      message: `Safe journey planned to ${parsedDestinationName}.`,
      actorRole: role,
      actorId: userId,
      metadata: {
        destinationLatitude: parsedDestinationLatitude,
        destinationLongitude: parsedDestinationLongitude,
      },
    });

    await createJourneyEvent({
      tx,
      journeyId: createdJourney.id,
      eventType: JourneyEventType.JOURNEY_STARTED,
      message: "Safe journey started.",
      actorRole: role,
      actorId: userId,
      metadata: {
        expectedArrivalAt,
        routeDistanceMeters: Number.isFinite(route.distanceMeters) ? route.distanceMeters : null,
        routeDurationSeconds,
      },
    });

    return tx.journey.findUnique({
      where: { id: createdJourney.id },
      include: journeyDetailInclude,
    });
  });

  return journey;
};

const listJourneysByRole = async ({ userId, role, status }) => {
  const where = {};
  if (status && Object.values(JourneyStatus).includes(status)) {
    where.status = status;
  }

  if (role === UserRole.ADMIN) {
    return prisma.journey.findMany({
      where,
      include: journeyListInclude,
      orderBy: { createdAt: "desc" },
      take: 150,
    });
  }

  if (role === UserRole.END_USER) {
    return prisma.journey.findMany({
      where: { ...where, plannedById: userId },
      include: journeyListInclude,
      orderBy: { createdAt: "desc" },
      take: 150,
    });
  }

  if (role === UserRole.GUARDIAN) {
    const links = await prisma.guardianLink.findMany({
      where: { guardianId: userId },
      select: { endUserId: true },
    });
    const endUserIds = links.map((item) => item.endUserId);
    if (!endUserIds.length) return [];
    return prisma.journey.findMany({
      where: { ...where, plannedById: { in: endUserIds } },
      include: journeyListInclude,
      orderBy: { createdAt: "desc" },
      take: 150,
    });
  }

  throw new AppError(403, "Unsupported role for journey listing.");
};

const getJourneyById = async ({ journeyId, userId, role }) => {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: journeyDetailInclude,
  });

  if (!journey) {
    throw new AppError(404, "Journey not found.");
  }

  await assertJourneyAccessible({ journey, userId, role });
  return journey;
};

const sendGuardianResponse = async ({
  journeyId,
  userId,
  role,
  messageTemplateKey,
  customMessage,
}) => {
  if (role !== UserRole.GUARDIAN) {
    throw new AppError(403, "Only GUARDIAN can send journey response messages.");
  }

  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: { escalationIncident: { select: { id: true } } },
  });
  if (!journey) {
    throw new AppError(404, "Journey not found.");
  }

  const link = await prisma.guardianLink.findFirst({
    where: { guardianId: userId, endUserId: journey.plannedById },
    select: { id: true },
  });
  if (!link) {
    throw new AppError(403, "You can only respond to linked end user journeys.");
  }

  if ([JourneyStatus.COMPLETED, JourneyStatus.CANCELLED].includes(journey.status)) {
    throw new AppError(400, "Cannot send response for a closed journey.");
  }

  const parsed = parseGuardianResponseMessage({ messageTemplateKey, customMessage });

  return prisma.$transaction(async (tx) => {
    const response = await tx.guardianJourneyResponse.create({
      data: {
        journeyId: journey.id,
        incidentId: journey.escalationIncidentId || null,
        guardianId: userId,
        endUserId: journey.plannedById,
        message: parsed.message,
        messageTemplateKey: parsed.messageTemplateKey,
      },
      include: {
        guardian: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await createJourneyEvent({
      tx,
      journeyId: journey.id,
      eventType: JourneyEventType.GUARDIAN_RESPONSE_SENT,
      message: `Guardian response sent: ${parsed.message}`,
      actorRole: role,
      actorId: userId,
      metadata: {
        responseId: response.id,
        messageTemplateKey: parsed.messageTemplateKey,
        incidentId: journey.escalationIncidentId || null,
      },
    });

    return response;
  });
};

const listGuardianResponses = async ({ journeyId, userId, role, limit = 100 }) => {
  const parsedJourneyId = Number(journeyId);
  if (!Number.isInteger(parsedJourneyId) || parsedJourneyId <= 0) {
    throw new AppError(400, "journeyId must be a valid integer.");
  }

  const journey = await prisma.journey.findUnique({
    where: { id: parsedJourneyId },
    select: { id: true, plannedById: true },
  });
  if (!journey) {
    throw new AppError(404, "Journey not found.");
  }

  await assertJourneyAccessible({ journey, userId, role });

  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return prisma.guardianJourneyResponse.findMany({
    where: { journeyId: parsedJourneyId },
    orderBy: { createdAt: "asc" },
    take,
    include: {
      guardian: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  });
};

const markGuardianResponseDelivery = async ({ responseId, deliveredViaRealtime, deliveryError }) => {
  return prisma.guardianJourneyResponse.update({
    where: { id: responseId },
    data: {
      deliveredViaRealtime: Boolean(deliveredViaRealtime),
      deliveryError: deliveryError ? String(deliveryError).slice(0, 300) : null,
    },
    include: {
      guardian: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  });
};

const addJourneyLocation = async ({
  journeyId,
  userId,
  role,
  latitude,
  longitude,
  accuracy,
  locationTimestamp,
  address,
}) => {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: {
      locations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!journey) {
    throw new AppError(404, "Journey not found.");
  }

  ensureJourneyOwnerOrAdmin({ journey, userId, role });

  if ([JourneyStatus.COMPLETED, JourneyStatus.CANCELLED].includes(journey.status)) {
    throw new AppError(400, "Journey is already closed.");
  }

  const parsedLatitude = parseCoordinate(latitude, "latitude", -90, 90);
  const parsedLongitude = parseCoordinate(longitude, "longitude", -180, 180);
  const parsedAccuracy = parseAccuracy(accuracy);
  const parsedLocationTimestamp = parseLocationTimestamp(locationTimestamp);
  const resolvedAddress =
    address?.trim() || (await reverseGeocode({ latitude: parsedLatitude, longitude: parsedLongitude }));

  const lastLocation = journey.locations[0];
  const isDuplicateUpdate =
    lastLocation &&
    Math.abs(lastLocation.latitude - parsedLatitude) < 0.000001 &&
    Math.abs(lastLocation.longitude - parsedLongitude) < 0.000001 &&
    (lastLocation.accuracy ?? null) === parsedAccuracy &&
    new Date(lastLocation.locationTimestamp).getTime() === parsedLocationTimestamp.getTime();

  if (isDuplicateUpdate) {
    return prisma.journey.findUnique({
      where: { id: journey.id },
      include: journeyDetailInclude,
    });
  }

  const deviation = evaluateDeviationSample({
    status: journey.status,
    routePolyline: journey.routePolyline,
    previousOffRouteCount: journey.offRouteCount,
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    accuracy: parsedAccuracy,
    thresholdMeters: DEVIATION_THRESHOLD_METERS,
    requiredCount: DEVIATION_REQUIRED_COUNT,
    maxAccuracyMeters: MAX_ACCURACY_FOR_DEVIATION_METERS,
  });
  const routeDeviationMeters = deviation.routeDeviationMeters;
  const isOffRoute = deviation.isOffRoute;

  const updatedJourney = await prisma.$transaction(async (tx) => {
    await tx.journeyLocation.create({
      data: {
        journeyId: journey.id,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        accuracy: parsedAccuracy,
        address: resolvedAddress || null,
        locationTimestamp: parsedLocationTimestamp,
        source: role === UserRole.ADMIN ? "ADMIN_UPDATE" : "USER_UPDATE",
      },
    });

    let nextStatus = journey.status;
    let nextOffRouteCount = deviation.nextOffRouteCount;
    let checkInReason = journey.checkInReason;
    let checkInRequiredAt = journey.checkInRequiredAt;
    let checkInExpiresAt = journey.checkInExpiresAt;

    await createJourneyEvent({
      tx,
      journeyId: journey.id,
      eventType: JourneyEventType.LOCATION_RECORDED,
      message: "Journey location updated.",
      actorRole: role,
      actorId: userId,
      metadata: {
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        accuracy: parsedAccuracy,
        routeDeviationMeters,
      },
    });

    if (isOffRoute && journey.status === JourneyStatus.ACTIVE) {
      await createJourneyEvent({
        tx,
        journeyId: journey.id,
        eventType: JourneyEventType.DEVIATION_DETECTED,
        message: `Possible route deviation detected (${routeDeviationMeters}m from route).`,
        actorRole: role,
        actorId: userId,
        metadata: {
          routeDeviationMeters,
          thresholdMeters: DEVIATION_THRESHOLD_METERS,
          offRouteCount: nextOffRouteCount,
        },
      });
    }

    if (journey.status === JourneyStatus.ACTIVE && deviation.shouldTriggerCheckIn) {
      nextStatus = JourneyStatus.CHECK_IN_REQUIRED;
      checkInReason = "Possible route deviation detected. Please confirm your safety.";
      checkInRequiredAt = new Date();
      checkInExpiresAt = new Date(checkInRequiredAt.getTime() + CHECK_IN_TIMEOUT_SECONDS * 1000);

      await createJourneyEvent({
        tx,
        journeyId: journey.id,
        eventType: JourneyEventType.CHECK_IN_REQUIRED,
        message: "Safety check-in required due to repeated route deviation.",
        actorRole: null,
        actorId: null,
        metadata: {
          thresholdMeters: DEVIATION_THRESHOLD_METERS,
          requiredConsecutiveReadings: DEVIATION_REQUIRED_COUNT,
          routeDeviationMeters,
          checkInExpiresAt,
        },
      });
    }

    await tx.journey.update({
      where: { id: journey.id },
      data: {
        status: nextStatus,
        currentLatitude: parsedLatitude,
        currentLongitude: parsedLongitude,
        currentAccuracy: parsedAccuracy,
        currentAddress: resolvedAddress || null,
        currentLocationAt: parsedLocationTimestamp,
        offRouteCount: nextOffRouteCount,
        checkInReason,
        checkInRequiredAt,
        checkInExpiresAt,
      },
    });

    return tx.journey.findUnique({
      where: { id: journey.id },
      include: journeyDetailInclude,
    });
  });

  return updatedJourney;
};

const confirmJourneySafety = async ({ journeyId, userId, role, note }) => {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
  });
  if (!journey) throw new AppError(404, "Journey not found.");

  ensureJourneyOwnerOrAdmin({ journey, userId, role });

  if (![JourneyStatus.CHECK_IN_REQUIRED, JourneyStatus.ESCALATED].includes(journey.status)) {
    throw new AppError(400, "Safety confirmation is only allowed when check-in is required.");
  }

  const reason = parseReason(note);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        status: JourneyStatus.ACTIVE,
        offRouteCount: 0,
        checkInReason: null,
        checkInRequiredAt: null,
        checkInExpiresAt: null,
        checkInAcknowledgedAt: new Date(),
      },
    });

    await createJourneyEvent({
      tx,
      journeyId: journey.id,
      eventType: JourneyEventType.SAFETY_CONFIRMED,
      message: "User confirmed safety and resumed journey monitoring.",
      actorRole: role,
      actorId: userId,
      metadata: reason ? { note: reason } : undefined,
    });

    return tx.journey.findUnique({
      where: { id: journey.id },
      include: journeyDetailInclude,
    });
  });

  return updated;
};

const completeJourney = async ({ journeyId, userId, role }) => {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
  });
  if (!journey) throw new AppError(404, "Journey not found.");

  ensureJourneyOwnerOrAdmin({ journey, userId, role });
  if ([JourneyStatus.COMPLETED, JourneyStatus.CANCELLED].includes(journey.status)) {
    return prisma.journey.findUnique({ where: { id: journey.id }, include: journeyDetailInclude });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        status: JourneyStatus.COMPLETED,
        completedAt: now,
        endedAt: now,
        checkInReason: null,
        checkInRequiredAt: null,
        checkInExpiresAt: null,
      },
    });

    await createJourneyEvent({
      tx,
      journeyId: journey.id,
      eventType: JourneyEventType.JOURNEY_COMPLETED,
      message: "Journey marked as completed.",
      actorRole: role,
      actorId: userId,
    });

    return tx.journey.findUnique({
      where: { id: journey.id },
      include: journeyDetailInclude,
    });
  });

  return updated;
};

const cancelJourney = async ({ journeyId, userId, role, reason }) => {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
  });
  if (!journey) throw new AppError(404, "Journey not found.");

  ensureJourneyOwnerOrAdmin({ journey, userId, role });
  if ([JourneyStatus.COMPLETED, JourneyStatus.CANCELLED].includes(journey.status)) {
    return prisma.journey.findUnique({ where: { id: journey.id }, include: journeyDetailInclude });
  }

  const note = parseReason(reason);

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        status: JourneyStatus.CANCELLED,
        cancelledAt: now,
        endedAt: now,
        checkInReason: null,
        checkInRequiredAt: null,
        checkInExpiresAt: null,
      },
    });

    await createJourneyEvent({
      tx,
      journeyId: journey.id,
      eventType: JourneyEventType.JOURNEY_CANCELLED,
      message: "Journey cancelled.",
      actorRole: role,
      actorId: userId,
      metadata: note ? { reason: note } : undefined,
    });

    return tx.journey.findUnique({
      where: { id: journey.id },
      include: journeyDetailInclude,
    });
  });

  return updated;
};

const listPendingEscalationJourneys = async () =>
  prisma.journey.findMany({
    where: {
      status: JourneyStatus.CHECK_IN_REQUIRED,
      checkInExpiresAt: { lte: new Date() },
      escalatedAt: null,
      endedAt: null,
    },
    include: {
      plannedBy: {
        select: { id: true, name: true, email: true, mobile: true, role: true },
      },
      locations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { checkInExpiresAt: "asc" },
    take: 30,
  });

const markJourneyEscalated = async ({ journeyId, incidentId }) => {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
  });
  if (!journey) {
    throw new AppError(404, "Journey not found.");
  }

  if (journey.status !== JourneyStatus.CHECK_IN_REQUIRED || journey.escalatedAt) {
    return prisma.journey.findUnique({ where: { id: journeyId }, include: journeyDetailInclude });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        status: JourneyStatus.ESCALATED,
        escalatedAt: new Date(),
        escalationIncidentId: incidentId,
      },
    });

    await createJourneyEvent({
      tx,
      journeyId: journey.id,
      eventType: JourneyEventType.ESCALATED_TO_SOS,
      message: "Journey check-in timeout escalated to SOS incident.",
      actorRole: null,
      actorId: null,
      metadata: { escalationIncidentId: incidentId },
    });

    return tx.journey.findUnique({
      where: { id: journey.id },
      include: journeyDetailInclude,
    });
  });

  return updated;
};

module.exports = {
  PREDEFINED_GUARDIAN_MESSAGES,
  searchDestinationSuggestions,
  reverseDestinationFromCoordinates,
  previewJourney,
  startJourney,
  listJourneysByRole,
  getJourneyById,
  sendGuardianResponse,
  listGuardianResponses,
  markGuardianResponseDelivery,
  addJourneyLocation,
  confirmJourneySafety,
  completeJourney,
  cancelJourney,
  listPendingEscalationJourneys,
  markJourneyEscalated,
};
