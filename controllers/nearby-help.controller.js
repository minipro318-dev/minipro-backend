const nearbyHelpService = require("../services/nearby-help.service");

const getNearbyHelp = async (req, res) => {
  const { latitude, longitude } = req.query;
  const places = await nearbyHelpService.findNearbyHelp({
    latitude,
    longitude,
  });

  return res.json({ places });
};

const getRouteToHelp = async (req, res) => {
  const { originLatitude, originLongitude, destinationLatitude, destinationLongitude, destinationName } = req.body;
  const route = await nearbyHelpService.getRouteToHelp({
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude,
    destinationName,
  });

  return res.json({ route });
};

module.exports = {
  getNearbyHelp,
  getRouteToHelp,
};

