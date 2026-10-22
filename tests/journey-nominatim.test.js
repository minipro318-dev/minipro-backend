const test = require("node:test");
const assert = require("node:assert/strict");
const { searchAddresses, reverseGeocodeAddress } = require("../utils/nominatim");

test("searchAddresses validates query length", async () => {
  await assert.rejects(
    () => searchAddresses({ query: "ab" }),
    (error) => error?.statusCode === 400 && /at least/.test(error.message),
  );
});

test("searchAddresses maps valid Nominatim response and reuses cache", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return {
      ok: true,
      async json() {
        return [
          {
            place_id: 123,
            display_name: "MG Road, Bengaluru, Karnataka, India",
            lat: "12.9755",
            lon: "77.6055",
          },
        ];
      },
    };
  };

  try {
    const first = await searchAddresses({ query: "mg road", limit: 5 });
    const second = await searchAddresses({ query: "mg road", limit: 5 });
    assert.equal(first.length, 1);
    assert.equal(first[0].displayName, "MG Road, Bengaluru, Karnataka, India");
    assert.equal(first[0].latitude, 12.9755);
    assert.equal(first[0].longitude, 77.6055);
    assert.equal(second.length, 1);
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reverseGeocodeAddress returns normalized destination payload", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return { display_name: "Koramangala, Bengaluru, Karnataka, India" };
    },
  });

  try {
    const result = await reverseGeocodeAddress({ latitude: 12.9352, longitude: 77.6245 });
    assert.equal(result.displayName, "Koramangala, Bengaluru, Karnataka, India");
    assert.equal(result.latitude, 12.9352);
    assert.equal(result.longitude, 77.6245);
  } finally {
    global.fetch = originalFetch;
  }
});
