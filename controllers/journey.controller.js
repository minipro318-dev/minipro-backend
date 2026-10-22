const journeyService = require("../services/journey.service");
const { emitJourneyToAuthorizedRecipients } = require("../lib/socket");

const emitJourneyUpdate = async (journey, eventName = "journey:updated") => {
  await emitJourneyToAuthorizedRecipients({
    journey,
    eventName,
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

const searchDestinations = async (req, res) => {
  const suggestions = await journeyService.searchDestinationSuggestions({
    role: req.auth.role,
    query: req.query.query,
    limit: req.query.limit,
  });

  return res.status(200).json({ suggestions });
};

const reverseDestination = async (req, res) => {
  const destination = await journeyService.reverseDestinationFromCoordinates({
    role: req.auth.role,
    latitude: req.query.latitude,
    longitude: req.query.longitude,
  });

  return res.status(200).json({ destination });
};

const previewJourney = async (req, res) => {
  const route = await journeyService.previewJourney({
    role: req.auth.role,
    originLatitude: req.body.originLatitude,
    originLongitude: req.body.originLongitude,
    destinationLatitude: req.body.destinationLatitude,
    destinationLongitude: req.body.destinationLongitude,
    destinationName: req.body.destinationName,
  });

  return res.status(200).json({
    message: "Journey route preview generated.",
    route,
  });
};

const startJourney = async (req, res) => {
  const journey = await journeyService.startJourney({
    userId: Number(req.auth.sub),
    role: req.auth.role,
    title: req.body.title,
    originLatitude: req.body.originLatitude,
    originLongitude: req.body.originLongitude,
    destinationLatitude: req.body.destinationLatitude,
    destinationLongitude: req.body.destinationLongitude,
    destinationName: req.body.destinationName,
    accuracy: req.body.accuracy,
    locationTimestamp: req.body.locationTimestamp,
    address: req.body.address,
  });

  await emitJourneyUpdate(journey, "journey:created");

  return res.status(201).json({
    message: "Safe journey started.",
    journey,
  });
};

const listJourneys = async (req, res) => {
  const journeys = await journeyService.listJourneysByRole({
    userId: Number(req.auth.sub),
    role: req.auth.role,
    status: req.query.status,
  });

  return res.status(200).json({ journeys });
};

const getJourneyById = async (req, res) => {
  const journey = await journeyService.getJourneyById({
    journeyId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
  });

  return res.status(200).json({ journey });
};

const listGuardianResponses = async (req, res) => {
  const responses = await journeyService.listGuardianResponses({
    journeyId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    limit: req.query.limit,
  });

  return res.status(200).json({ responses });
};

const sendGuardianResponse = async (req, res) => {
  const journeyId = Number(req.params.id);
  const response = await journeyService.sendGuardianResponse({
    journeyId,
    userId: Number(req.auth.sub),
    role: req.auth.role,
    messageTemplateKey: req.body?.messageTemplateKey,
    customMessage: req.body?.customMessage,
  });

  const journey = await journeyService.getJourneyById({
    journeyId,
    userId: Number(req.auth.sub),
    role: req.auth.role,
  });

  let responseWithDelivery = response;
  try {
    await emitJourneyToAuthorizedRecipients({
      journey,
      eventName: "journey:guardian-response",
      payload: {
        journeyId: journey.id,
        userId: journey.plannedById,
        createdAt: response.createdAt,
        response,
      },
    });
    responseWithDelivery = await journeyService.markGuardianResponseDelivery({
      responseId: response.id,
      deliveredViaRealtime: true,
      deliveryError: null,
    });
  } catch (deliveryError) {
    console.error("Failed to deliver guardian response realtime event", deliveryError);
    responseWithDelivery = await journeyService.markGuardianResponseDelivery({
      responseId: response.id,
      deliveredViaRealtime: false,
      deliveryError: deliveryError?.message || "realtime delivery failed",
    });
  }

  await emitJourneyUpdate(journey);

  return res.status(201).json({
    message: "Guardian response sent.",
    response: responseWithDelivery,
  });
};

const addJourneyLocation = async (req, res) => {
  const journey = await journeyService.addJourneyLocation({
    journeyId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    accuracy: req.body.accuracy,
    locationTimestamp: req.body.locationTimestamp,
    address: req.body.address,
  });

  await emitJourneyUpdate(journey);

  return res.status(200).json({
    message: "Journey location updated.",
    journey,
  });
};

const confirmSafety = async (req, res) => {
  const journey = await journeyService.confirmJourneySafety({
    journeyId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    note: req.body?.note,
  });

  await emitJourneyUpdate(journey);

  return res.status(200).json({
    message: "Safety confirmation recorded. Journey monitoring resumed.",
    journey,
  });
};

const completeJourney = async (req, res) => {
  const journey = await journeyService.completeJourney({
    journeyId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
  });

  await emitJourneyUpdate(journey);

  return res.status(200).json({
    message: "Journey marked as completed.",
    journey,
  });
};

const cancelJourney = async (req, res) => {
  const journey = await journeyService.cancelJourney({
    journeyId: Number(req.params.id),
    userId: Number(req.auth.sub),
    role: req.auth.role,
    reason: req.body?.reason,
  });

  await emitJourneyUpdate(journey);

  return res.status(200).json({
    message: "Journey cancelled.",
    journey,
  });
};

module.exports = {
  searchDestinations,
  reverseDestination,
  previewJourney,
  startJourney,
  listJourneys,
  getJourneyById,
  listGuardianResponses,
  sendGuardianResponse,
  addJourneyLocation,
  confirmSafety,
  completeJourney,
  cancelJourney,
  emitJourneyUpdate,
};
