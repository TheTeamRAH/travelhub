import assert from "node:assert/strict";
import test from "node:test";
import { buildStaticMapUrl } from "./road-map";

test("builds a server-side static map URL without exposing route addresses", () => {
  const url = buildStaticMapUrl({
    encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
    apiKey: "server-test-key",
    trafficStatus: "Delays building",
  });

  const parsed = new URL(url);
  assert.equal(parsed.hostname, "maps.googleapis.com");
  assert.equal(parsed.pathname, "/maps/api/staticmap");
  assert.equal(parsed.searchParams.get("size"), "640x360");
  assert.ok(parsed.searchParams.get("center"));
  assert.ok(parsed.searchParams.get("zoom"));
  assert.match(parsed.searchParams.get("path") || "", /color:0xD97706FF/);
  assert.equal(parsed.searchParams.get("key"), "server-test-key");
  assert.doesNotMatch(url, /origin|destination|address/i);
});

test("rejects a missing polyline", () => {
  assert.throws(() => buildStaticMapUrl({ encodedPolyline: "", apiKey: "key" }), /polyline/);
});
