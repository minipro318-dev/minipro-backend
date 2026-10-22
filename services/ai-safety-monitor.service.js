const prisma = require("../lib/prisma");
const aiSafetyEventService = require("./ai-safety-event.service");
const { emitAiSafetyEventToAuthorizedRecipients, emitToAuthorizedRecipients } = require("../lib/socket");
const { sendAiSafetyEscalationEmail } = require("../utils/mailer");

const MONITOR_INTERVAL_MS = Math.max(5000, Number(process.env.AI_SAFETY_MONITOR_INTERVAL_MS || 10000));
const EMAIL_RETRY_COUNT = Math.max(0, Number(process.env.AI_SAFETY_EMAIL_RETRY_COUNT || 2));
const EMAIL_RETRY_BACKOFF_MS = Math.max(250, Number(process.env.AI_SAFETY_EMAIL_RETRY_BACKOFF_MS || 800));

let monitorTimer = null;
let monitorInProgress = false;

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const eventPayload = (event) => ({
  eventId: event.id,
  userId: event.userId,
  status: event.status,
  detectedAt: event.detectedAt,
  confirmationDeadline: event.confirmationDeadline,
  escalatedAt: event.escalatedAt,
  linkedIncidentId: event.linkedIncidentId,
  event,
});

const broadcastEvent = async (event, eventName) =>
  emitAiSafetyEventToAuthorizedRecipients({
    aiSafetyEvent: event,
    eventName,
    payload: eventPayload(event),
  });

const sendGuardianEscalationNotifications = async ({ event, incident }) => {
  const linkedGuardians = await prisma.guardianLink.findMany({
    where: { endUserId: event.userId },
    select: {
      guardian: {
        select: { email: true, name: true, status: true },
      },
    },
  });

  const recipients = linkedGuardians
    .map((item) => item.guardian)
    .filter((guardian) => guardian?.status && guardian.email)
    .map((guardian) => ({ email: guardian.email, name: guardian.name || "Guardian" }));

  const failures = [];
  const userName = event.user?.name || "User";
  for (const recipient of recipients) {
    let sent = false;
    let lastError = null;
    for (let attempt = 0; attempt <= EMAIL_RETRY_COUNT; attempt += 1) {
      try {
        await sendAiSafetyEscalationEmail({
          toEmail: recipient.email,
          toName: recipient.name,
          userName,
          eventId: event.id,
          detectedAt: event.detectedAt,
          lastKnownAddress: event.lastKnownAddress,
          lastKnownLatitude: event.lastKnownLatitude,
          lastKnownLongitude: event.lastKnownLongitude,
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
      failures.push({
        email: recipient.email,
        message: lastError instanceof Error ? lastError.message : "Unknown error",
      });
      console.error(`Failed AI escalation email for event #${event.id} to ${recipient.email}`, lastError);
    }
  }

  return failures;
};

const escalateEventNow = async ({ eventId, userResponse, escalationReason, responseReason, escalatedById }) => {
  const escalation = await aiSafetyEventService.escalateEventWithIncident({
    eventId,
    userResponse,
    escalationReason,
    responseReason,
    escalatedById,
  });
  const updatedEvent = escalation.event;
  const escalationIncident = escalation.incident;

  const emailFailures = await sendGuardianEscalationNotifications({
    event: updatedEvent,
    incident: escalationIncident,
  });

  const notificationError = emailFailures.length ? `Failed to notify ${emailFailures.length} guardian(s).` : null;
  const withStatus = await prisma.aiSafetyEvent.update({
    where: { id: updatedEvent.id },
    data: {
      notificationError,
      notifiedAt: new Date(),
    },
    include: {
      user: { select: { id: true, name: true, email: true, mobile: true, role: true } },
      linkedIncident: {
        include: {
          reportedBy: { select: { id: true, name: true, email: true, mobile: true, role: true } },
          resolvedBy: { select: { id: true, name: true, email: true, role: true } },
          locationLogs: { orderBy: { createdAt: "desc" }, take: 5 },
        },
      },
    },
  });

  await broadcastEvent(withStatus, "ai-safety:event-updated");
  await emitToAuthorizedRecipients({
    incident: escalationIncident,
    eventName: "incident:created",
    payload: {
      incidentId: escalationIncident.id,
      userId: escalationIncident.reportedById,
      latitude: escalationIncident.locationLogs[0]?.latitude ?? null,
      longitude: escalationIncident.locationLogs[0]?.longitude ?? null,
      accuracy: escalationIncident.locationLogs[0]?.accuracy ?? null,
      locationTimestamp: escalationIncident.locationLogs[0]?.locationTimestamp ?? null,
      createdAt: escalationIncident.createdAt,
      status: escalationIncident.status,
      incident: escalationIncident,
    },
  });

  return withStatus;
};

const processOneEscalation = async (event) => {
  await escalateEventNow({
    eventId: event.id,
    userResponse: "NO_RESPONSE",
    escalationReason: "No safety confirmation received before timeout.",
  });
};

const runMonitorTick = async () => {
  if (monitorInProgress) return;
  monitorInProgress = true;
  try {
    const pending = await aiSafetyEventService.listPendingEscalations();
    for (const event of pending) {
      try {
        await processOneEscalation(event);
      } catch (error) {
        console.error(`AI safety escalation failed for event #${event.id}`, error);
      }
    }
  } finally {
    monitorInProgress = false;
  }
};

const startAiSafetyMonitor = () => {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    void runMonitorTick();
  }, MONITOR_INTERVAL_MS);
  void runMonitorTick();
};

const stopAiSafetyMonitor = () => {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
};

module.exports = { startAiSafetyMonitor, stopAiSafetyMonitor, escalateEventNow };
