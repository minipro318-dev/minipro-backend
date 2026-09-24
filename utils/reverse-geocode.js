const reverseGeocode = async ({ latitude, longitude }) => {
  const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
  endpoint.searchParams.set("lat", String(latitude));
  endpoint.searchParams.set("lon", String(longitude));
  endpoint.searchParams.set("format", "jsonv2");

  try {
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "women-safety-platform/1.0",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    if (typeof payload?.display_name === "string" && payload.display_name.trim()) {
      return payload.display_name.trim();
    }
    return null;
  } catch {
    return null;
  }
};

module.exports = { reverseGeocode };
