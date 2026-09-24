const { IncidentStatus, UserRole } = require("@prisma/client");
const prisma = require("../lib/prisma");
const AppError = require("../utils/app-error");
const { reverseGeocode } = require("../utils/reverse-geocode");

const incidentInclude = {
  reportedBy: {
    select: { id: true, name: true, email: true, mobile: true, role: true },
  },
  resolvedBy: {
    select: { id: true, name: true, email: true, role: true },
  },
  locationLogs: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
};

const incidentListInclude = {
  ...incidentInclude,
  locationLogs: {
    orderBy: { createdAt: "desc" },
    take: 100,
  },
};

const assertValidCoordinates = (latitude, longitude) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new AppError(400, "latitude and longitude must be valid numbers.");
  }
  if (latitude < -90 || latitude > 90) {
    throw new AppError(400, "latitude must be between -90 and 90.");
  }
  if (longitude < -180 || longitude > 180) {
    throw new AppError(400, "longitude must be between -180 and 180.");
  }
};

const parseLocationAccuracy = (accuracy) => {
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
  if (!locationTimestamp) {
    return new Date();
  }

  const parsed = new Date(locationTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "locationTimestamp must be a valid ISO datetime.");
  }
  return parsed;
};

const createSosIncident = async ({
  userId,
  role,
  title,
  description,
  latitude,
  longitude,
  accuracy,
  locationTimestamp,
  address,
}) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can trigger SOS incidents.");
  }

  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  const parsedAccuracy = parseLocationAccuracy(accuracy);
  const parsedLocationTimestamp = parseLocationTimestamp(locationTimestamp);
  assertValidCoordinates(parsedLatitude, parsedLongitude);
  const resolvedAddress = address?.trim() || (await reverseGeocode({ latitude: parsedLatitude, longitude: parsedLongitude }));

  const incident = await prisma.incident.create({
    data: {
      title: title?.trim() || "Emergency SOS",
      description: description?.trim() || null,
      reportedById: userId,
      locationLogs: {
        create: {
          latitude: parsedLatitude,
          longitude: parsedLongitude,
          accuracy: parsedAccuracy,
          locationTimestamp: parsedLocationTimestamp,
          address: resolvedAddress || null,
          source: "SOS_TRIGGER",
          createdById: userId,
        },
      },
    },
    include: incidentInclude,
  });

  return incident;
};

const getAccessibleIncident = async ({ incidentId, userId, role }) => {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      ...incidentInclude,
      locationLogs: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!incident) {
    throw new AppError(404, "Incident not found.");
  }

  if (role === UserRole.ADMIN) {
    return incident;
  }

  if (role === UserRole.END_USER) {
    if (incident.reportedById !== userId) {
      throw new AppError(403, "You do not have access to this incident.");
    }
    return incident;
  }

  if (role === UserRole.GUARDIAN) {
    const linked = await prisma.guardianLink.findFirst({
      where: { guardianId: userId, endUserId: incident.reportedById },
      select: { id: true },
    });
    if (!linked) {
      throw new AppError(403, "You do not have access to this incident.");
    }
    return incident;
  }

  throw new AppError(403, "You do not have access to this incident.");
};

const addIncidentLocation = async ({
  incidentId,
  userId,
  role,
  latitude,
  longitude,
  accuracy,
  locationTimestamp,
  address,
}) => {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, reportedById: true, status: true },
  });

  if (!incident) {
    throw new AppError(404, "Incident not found.");
  }

  if (incident.status !== IncidentStatus.ACTIVE) {
    throw new AppError(400, "Location can only be added to ACTIVE incidents.");
  }

  const isOwner = incident.reportedById === userId;
  const isAdmin = role === UserRole.ADMIN;

  if (!(isOwner || isAdmin)) {
    throw new AppError(403, "Only incident owner or admin can add location updates.");
  }

  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  const parsedAccuracy = parseLocationAccuracy(accuracy);
  const parsedLocationTimestamp = parseLocationTimestamp(locationTimestamp);
  assertValidCoordinates(parsedLatitude, parsedLongitude);
  const resolvedAddress = address?.trim() || (await reverseGeocode({ latitude: parsedLatitude, longitude: parsedLongitude }));

  const lastLocation = await prisma.incidentLocation.findFirst({
    where: { incidentId: incident.id },
    orderBy: { createdAt: "desc" },
    select: { latitude: true, longitude: true, accuracy: true, locationTimestamp: true },
  });

  const isDuplicateUpdate =
    lastLocation &&
    Math.abs(lastLocation.latitude - parsedLatitude) < 0.000001 &&
    Math.abs(lastLocation.longitude - parsedLongitude) < 0.000001 &&
    (lastLocation.accuracy ?? null) === parsedAccuracy &&
    new Date(lastLocation.locationTimestamp).getTime() === parsedLocationTimestamp.getTime();

  if (isDuplicateUpdate) {
    return prisma.incident.findUnique({
      where: { id: incident.id },
      include: incidentInclude,
    });
  }

  await prisma.incidentLocation.create({
    data: {
      incidentId: incident.id,
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      accuracy: parsedAccuracy,
      locationTimestamp: parsedLocationTimestamp,
      address: resolvedAddress || null,
      source: isAdmin ? "ADMIN_UPDATE" : "USER_UPDATE",
      createdById: userId,
    },
  });

  const updated = await prisma.incident.findUnique({
    where: { id: incident.id },
    include: incidentInclude,
  });

  return updated;
};

const updateIncidentStatus = async ({ incidentId, userId, role, status }) => {
  if (![IncidentStatus.RESOLVED, IncidentStatus.CANCELLED].includes(status)) {
    throw new AppError(400, "status must be RESOLVED or CANCELLED.");
  }

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, reportedById: true, status: true },
  });

  if (!incident) {
    throw new AppError(404, "Incident not found.");
  }

  if (incident.status !== IncidentStatus.ACTIVE) {
    throw new AppError(400, "Only ACTIVE incidents can be updated.");
  }

  const isAdmin = role === UserRole.ADMIN;
  const isOwner = role === UserRole.END_USER && incident.reportedById === userId;
  const ownerCanCancelOnly = status === IncidentStatus.CANCELLED;

  if (!isAdmin && !(isOwner && ownerCanCancelOnly)) {
    throw new AppError(403, "You do not have permission to update this incident status.");
  }

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: {
      status,
      resolvedById: isAdmin ? userId : null,
      resolvedAt: new Date(),
    },
    include: incidentInclude,
  });

  return updated;
};

const listIncidentsByRole = async ({ userId, role }) => {
  if (role === UserRole.ADMIN) {
    return prisma.incident.findMany({
      include: incidentListInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  if (role === UserRole.END_USER) {
    return prisma.incident.findMany({
      where: { reportedById: userId },
      include: incidentListInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  if (role === UserRole.GUARDIAN) {
    const links = await prisma.guardianLink.findMany({
      where: { guardianId: userId },
      select: { endUserId: true },
    });

    const endUserIds = links.map((item) => item.endUserId);
    if (!endUserIds.length) {
      return [];
    }

    return prisma.incident.findMany({
      where: { reportedById: { in: endUserIds } },
      include: incidentListInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  throw new AppError(403, "Unsupported role for incident listing.");
};

module.exports = {
  createSosIncident,
  getAccessibleIncident,
  addIncidentLocation,
  updateIncidentStatus,
  listIncidentsByRole,
};
