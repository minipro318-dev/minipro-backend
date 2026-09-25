const { IncidentStatus } = require("@prisma/client");
const incidentService = require("../services/incident.service");
const { emitToAuthorizedRecipients } = require("../lib/socket");

const triggerSos = async (req, res) => {
  const incident = await incidentService.createSosIncident({
    userId: Number(req.auth.sub),
    role: req.auth.role,
    title: req.body.title,
    description: req.body.description,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    accuracy: req.body.accuracy,
    locationTimestamp: req.body.locationTimestamp,
    address: req.body.address,
  });

  await emitToAuthorizedRecipients({
    incident,
    eventName: "incident:created",
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

  return res.status(201).json({
    message: "SOS incident created successfully.",
    incident,
  });
};

const listIncidents = async (req, res) => {
  const incidents = await incidentService.listIncidentsByRole({
    userId: Number(req.auth.sub),
    role: req.auth.role,
  });

  return res.status(200).json({ incidents });
};

const getIncidentById = async (req, res) => {
  const incident = await incidentService.getAccessibleIncident({
    incidentId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
  });

  return res.status(200).json({ incident });
};

const addLocation = async (req, res) => {
  const incident = await incidentService.addIncidentLocation({
    incidentId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    accuracy: req.body.accuracy,
    locationTimestamp: req.body.locationTimestamp,
    address: req.body.address,
  });

  await emitToAuthorizedRecipients({
    incident,
    eventName: "incident:location-updated",
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

  return res.status(200).json({
    message: "Incident location updated successfully.",
    incident,
  });
};

const resolveIncident = async (req, res) => {
  const incident = await incidentService.updateIncidentStatus({
    incidentId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    status: IncidentStatus.RESOLVED,
    resolutionNote: req.body?.resolutionNote,
  });

  await emitToAuthorizedRecipients({
    incident,
    eventName: "incident:status-updated",
    payload: {
      incidentId: incident.id,
      userId: incident.reportedById,
      status: incident.status,
      resolvedAt: incident.resolvedAt,
      resolvedByRole: incident.resolvedByRole,
      resolutionNote: incident.resolutionNote,
      createdAt: incident.createdAt,
      incident,
    },
  });

  return res.status(200).json({
    message: "Incident marked as resolved.",
    incident,
  });
};

const cancelIncident = async (req, res) => {
  const incident = await incidentService.updateIncidentStatus({
    incidentId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    status: IncidentStatus.CANCELLED,
  });

  await emitToAuthorizedRecipients({
    incident,
    eventName: "incident:status-updated",
    payload: {
      incidentId: incident.id,
      userId: incident.reportedById,
      status: incident.status,
      resolvedAt: incident.resolvedAt,
      resolvedByRole: incident.resolvedByRole,
      resolutionNote: incident.resolutionNote,
      createdAt: incident.createdAt,
      incident,
    },
  });

  return res.status(200).json({
    message: "Incident cancelled successfully.",
    incident,
  });
};

module.exports = {
  triggerSos,
  listIncidents,
  getIncidentById,
  addLocation,
  resolveIncident,
  cancelIncident,
};
