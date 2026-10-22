const aiSafetyEventService = require("../services/ai-safety-event.service");
const { escalateEventNow } = require("../services/ai-safety-monitor.service");
const { emitAiSafetyEventToAuthorizedRecipients } = require("../lib/socket");
const AppError = require("../utils/app-error");

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

const emitEventUpdate = async (event, eventName) =>
  emitAiSafetyEventToAuthorizedRecipients({
    aiSafetyEvent: event,
    eventName,
    payload: eventPayload(event),
  });

const createDetection = async (req, res) => {
  const event = await aiSafetyEventService.createDetectionEvent({
    userId: Number(req.auth.sub),
    role: req.auth.role,
    payload: req.body || {},
  });

  await emitEventUpdate(event, "ai-safety:event-created");
  return res.status(201).json({
    message: "AI safety event created.",
    event,
  });
};

const listEvents = async (req, res) => {
  const events = await aiSafetyEventService.listEventsByRole({
    userId: Number(req.auth.sub),
    role: req.auth.role,
    status: req.query.status,
    limit: req.query.limit,
  });
  return res.status(200).json({ events });
};

const getEventById = async (req, res) => {
  const event = await aiSafetyEventService.getAccessibleEvent({
    eventId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
  });
  return res.status(200).json({ event });
};

const acknowledgeEvent = async (req, res) => {
  const event = await aiSafetyEventService.respondToEvent({
    eventId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    action: "ACKNOWLEDGE",
    reason: req.body?.reason,
  });

  await emitEventUpdate(event, "ai-safety:event-updated");
  return res.status(200).json({ message: "Safety status acknowledged.", event });
};

const markFalseAlarm = async (req, res) => {
  const event = await aiSafetyEventService.respondToEvent({
    eventId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    action: "FALSE_ALARM",
    reason: req.body?.reason,
  });

  await emitEventUpdate(event, "ai-safety:event-updated");
  return res.status(200).json({ message: "Event marked as false alarm.", event });
};

const requestHelp = async (req, res) => {
  const existingEvent = await aiSafetyEventService.getAccessibleEvent({
    eventId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
  });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : null;
  const isOwner = req.auth.role === "END_USER" && existingEvent.userId === Number(req.auth.sub);
  const isAdmin = req.auth.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    throw new AppError(403, "Only the end user or admin can request help for this event.");
  }

  const event = await escalateEventNow({
    eventId: existingEvent.id,
    userResponse: "REQUEST_HELP",
    responseReason: reason || null,
    escalationReason: "User explicitly requested help from AI safety confirmation.",
    escalatedById: isAdmin ? Number(req.auth.sub) : null,
  });

  return res.status(200).json({ message: "Help requested and escalation started.", event });
};

const getAdminStats = async (req, res) => {
  const stats = await aiSafetyEventService.getAdminOverview();
  return res.status(200).json({ stats });
};

module.exports = {
  createDetection,
  listEvents,
  getEventById,
  acknowledgeEvent,
  markFalseAlarm,
  requestHelp,
  getAdminStats,
};
