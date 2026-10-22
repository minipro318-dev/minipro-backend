const { reverseGeocodeAddress } = require("./nominatim");

const reverseGeocode = async ({ latitude, longitude }) => {
  try {
    const result = await reverseGeocodeAddress({ latitude, longitude });
    return result.displayName;
  } catch {
    return null;
  }
};

module.exports = { reverseGeocode };
