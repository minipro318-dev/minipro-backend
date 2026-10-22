const { IncidentStatus } = require("@prisma/client");
const prisma = require("../lib/prisma");
const journeyService = require("./journey.service");
const { emitJourneyToAuthorizedRecipients, emitToAuthorizedRecipients } = require("../lib/socket");
const { sendJourneyEscalationEmail } = require("../utils/mailer");

const MONITOR_INTERVAL_MS = Math.max(10000, Number(process.env.JOURNEY_MONITOR_INTERVAL_MS || 20000));

let monitorTimer = null;
let monitorInProgress = false;
const EMAIL_RETRY_COUNT = Math.max(0, Number(process.env.JOURNEY_ESCALATION_EMAIL_RETRY_COUNT || 2));
const EMAIL_RETRY_BACKOFF_MS = Math.max(250, Number(process.env.JOURNEY_ESCALATION_EMAIL_RETRY_BACKOFF_MS || 600));

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const broadcastJourneyUpdate = async (journey) => {
  await emitJourneyToAuthorizedRecipients({
    journey,
    eventName: "journey:updated",
    payload: {
      journeyId: journey.id,
      userId: journey.plannedById,
      status: journey.status,
      checkInRequiredAt: journey.checkInRequiredAt,
      checkInExpiresAt: journey.checkInExpiresAt,
      escalatedAt: journey.escalatedAt,
      updatedAt: journey.updatedAt,
      journey,
    },
  });
};

const sendEscalationNotifications = async ({ journey, incident }) => {
  const linkedGuardians = await prisma.guardianLink.findMany({
    where: { endUserId: journey.plannedById },
    select: {
      guardian: {
        select: { email: true, name: true, status: true },
      },
    },
  });

  const recipients = linkedGuardians
    .map((item) => item.guardian)
    .filter((guardian) => guardian?.status && guardian.email)
    .map((guardian) => ({
      email: guardian.email,
      name: guardian.name || "Guardian",
    }));

  const failures = [];

  for (const recipient of recipients) {
    let sent = false;
    let lastError = null;

    for (let attempt = 0; attempt <= EMAIL_RETRY_COUNT; attempt += 1) {
      try {
        await sendJourneyEscalationEmail({
          toEmail: recipient.email,
          toName: recipient.name,
          journeyId: journey.id,
          userName: journey.plannedBy.name,
          destinationName: journey.destinationName,
          lastKnownAddress: journey.currentAddress,
          lastKnownLatitude: journey.currentLatitude,
          lastKnownLongitude: journey.currentLongitude,
          incidentId: incident?.id || null,
        });
        sent = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < EMAIL_RETRY_COUNT) {
          await wait(EMAIL_RETRY_BACKOFF_MS * (attempt + 1));
        }
      }
    }

    if (!sent) {
      console.error(
        `Failed to send journey escalation email for journey #${journey.id} to ${recipient.email}`,
        lastError,
      );
      failures.push({
        email: recipient.email,
        message: lastError instanceof Error ? lastError.message : "Unknown error",
      });
    }
  }

  return {
    totalRecipients: recipients.length,
    failedRecipients: failures,
  };
};

const buildEscalationLocationPayload = (journey) => ({
  latitude: Number.isFinite(journey.currentLatitude) ? journey.currentLatitude : null,
  longitude: Number.isFinite(journey.currentLongitude) ? journey.currentLongitude : null,
  accuracy: Number.isFinite(journey.currentAccuracy) ? journey.currentAccuracy : null,
  locationTimestamp: journey.currentLocationAt || new Date(),
  address: journey.currentAddress || null,
});

const upsertEscalationIncident = async (journey) => {
  const activeIncident = await prisma.incident.findFirst({
    where: {
      reportedById: journey.plannedById,
      status: IncidentStatus.ACTIVE,
    },
    include: {
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
    },
  });

  const locationPayload = buildEscalationLocationPayload(journey);

  if (activeIncident) {
    if (Number.isFinite(locationPayload.latitude) && Number.isFinite(locationPayload.longitude)) {
      await prisma.incidentLocation.create({
        data: {
          incidentId: activeIncident.id,
          latitude: locationPayload.latitude,
          longitude: locationPayload.longitude,
          accuracy: locationPayload.accuracy,
          locationTimestamp: locationPayload.locationTimestamp,
          address: locationPayload.address,
          source: "JOURNEY_ESCALATION",
          createdById: journey.plannedById,
        },
      });
    }

    const incident = await prisma.incident.findUnique({
      where: { id: activeIncident.id },
      include: {
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
      },
    });
    return { incident, isNew: false };
  }

  const createdIncident = await prisma.incident.create({
    data: {
      title: "Journey safety escalation",
      description: `Safe journey #${journey.id} check-in timed out.`,
      status: IncidentStatus.ACTIVE,
      reportedById: journey.plannedById,
      locationLogs:
        Number.isFinite(locationPayload.latitude) && Number.isFinite(locationPayload.longitude)
          ? {
              create: {
                latitude: locationPayload.latitude,
                longitude: locationPayload.longitude,
                accuracy: locationPayload.accuracy,
                locationTimestamp: locationPayload.locationTimestamp,
                address: locationPayload.address,
                source: "JOURNEY_ESCALATION",
                createdById: journey.plannedById,
              },
            }
          : undefined,
    },
    include: {
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
    },
  });

  return { incident: createdIncident, isNew: true };
};

const processOneEscalation = async (journey) => {
  const escalationIncident = await upsertEscalationIncident(journey);
  const incident = escalationIncident.incident;
  const updatedJourney = await journeyService.markJourneyEscalated({
    journeyId: journey.id,
    incidentId: incident.id,
  });

  await emitToAuthorizedRecipients({
    incident,
    eventName: escalationIncident.isNew ? "incident:created" : "incident:location-updated",
    payload: {
      incidentId: incident.id,
      userId: incident.reportedById,
      latitude: incident.locationLogs[0]?.latitude ?? null,
      longitude: incident.locationLogs[0]?.longitude ?? null,
      accuracy: incident.locationLogs[0]?.accuracy ?? null,
      locationTimestamp: incident.locationLogs[0]?.locationTimestamp ?? null,
      createdAt: incident.createdAt,
      status: incident.status,
      incident,
    },
  });

  const notificationResult = await sendEscalationNotifications({ journey: updatedJourney, incident });
  const failureSummary =
    notificationResult.failedRecipients.length > 0
      ? `Failed to notify ${notificationResult.failedRecipients.length} guardian(s).`
      : null;

  const journeyWithNotificationStatus = await prisma.journey.update({
    where: { id: updatedJourney.id },
    data: {
      lastEscalationNotifiedAt: new Date(),
      lastEscalationNotificationError: failureSummary,
    },
    include: {
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
    },
  });

  await broadcastJourneyUpdate(journeyWithNotificationStatus);
};

const runMonitorTick = async () => {
  if (monitorInProgress) return;
  monitorInProgress = true;
  try {
    const pendingEscalations = await journeyService.listPendingEscalationJourneys();
    for (const journey of pendingEscalations) {
      try {
        await processOneEscalation(journey);
      } catch (error) {
        console.error(`Safe journey escalation failed for journey #${journey.id}`, error);
      }
    }
  } finally {
    monitorInProgress = false;
  }
};

const startJourneyMonitor = () => {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    void runMonitorTick();
  }, MONITOR_INTERVAL_MS);
  void runMonitorTick();
};

const stopJourneyMonitor = () => {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
};

module.exports = { startJourneyMonitor, stopJourneyMonitor };
