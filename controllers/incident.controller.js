const { IncidentStatus } = require("@prisma/client");
const incidentService = require("../services/incident.service");

const triggerSos = async (req, res) => {
  const incident = await incidentService.createSosIncident({
    userId: Number(req.auth.sub),
    role: req.auth.role,
    title: req.body.title,
    description: req.body.description,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    address: req.body.address,
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
    address: req.body.address,
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
