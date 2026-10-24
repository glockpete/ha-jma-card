"use strict";
// Sibling discovery through hass.entities (device_id + platform + translation_key) and the precedence of `entities:`.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { discoverSiblings, resolveRoles, normaliseConfig, SIBLING_KEYS } = H.helpers;
test.afterEach(() => H.cleanup());

test("discovery: every ha-jma sensor of the weather entity's device is found by translation_key", () => {
  const found = discoverSiblings(F.makeHass(), "weather.jma_chiyoda");
  assert.equal(found.warnings, "sensor.jma_chiyoda_warnings");
  assert.equal(found.rain, "sensor.jma_chiyoda_rain_next_hour");
  assert.equal(found.frames, "sensor.jma_chiyoda_radar_frames");
  assert.equal(found.feed, "binary_sensor.jma_chiyoda_feed_problem");
  assert.equal(found.quake, "sensor.jma_chiyoda_last_earthquake");
  assert.equal(found.wbgt, "sensor.jma_chiyoda_wbgt");
  assert.equal(found.japan, "sensor.jma_chiyoda_japan");
  assert.deepEqual(Object.keys(found).sort(), Object.keys(SIBLING_KEYS).sort());
});

test("discovery: another area's sensors and another integration's are not picked", () => {
  const found = discoverSiblings(F.makeHass(), "weather.jma_chiyoda");
  assert.notEqual(found.wbgt, "sensor.jma_osaka_wbgt");
  assert.notEqual(found.wbgt, "sensor.other_wbgt");
  const osaka = discoverSiblings(F.makeHass(), "weather.jma_osaka");
  assert.deepEqual(osaka, { wbgt: "sensor.jma_osaka_wbgt" });
});

test("discovery: an entity outside the registry, or without a device, finds nothing", () => {
  assert.deepEqual(discoverSiblings(F.makeHass(), "weather.not_there"), {});
  assert.deepEqual(discoverSiblings(F.makeHass(), "weather.forecast_home"), {});
  const hass = F.makeHass();
  hass.entities["weather.jma_chiyoda"] = { ...hass.entities["weather.jma_chiyoda"], device_id: null };
  assert.deepEqual(discoverSiblings(hass, "weather.jma_chiyoda"), {});
  assert.deepEqual(discoverSiblings({}, "weather.jma_chiyoda"), {});
  assert.deepEqual(discoverSiblings(null, "weather.jma_chiyoda"), {});
});

test("discovery: a sensor ha-jma left disabled is simply absent (the registry does not list it)", () => {
  const hass = F.makeHass();
  delete hass.entities["sensor.jma_chiyoda_radar_frames"];
  const roles = resolveRoles(normaliseConfig({ entity: "weather.jma_chiyoda" }), hass);
  assert.equal(roles.frames, null);
  assert.equal(roles.warnings, "sensor.jma_chiyoda_warnings");
});

test("precedence: entities: wins over the discovered sibling, per role", () => {
  const cfg = normaliseConfig({ entity: "weather.jma_chiyoda", entities: { wbgt: "sensor.my_own_wbgt", sun: "sun.other_sun" } });
  const roles = resolveRoles(cfg, F.makeHass());
  assert.equal(roles.wbgt, "sensor.my_own_wbgt");
  assert.equal(roles.sun, "sun.other_sun");
  assert.equal(roles.warnings, "sensor.jma_chiyoda_warnings");
});

test("sun defaults to sun.sun and the weather entity is always the configured one", () => {
  const roles = resolveRoles(normaliseConfig({ entity: "weather.jma_chiyoda" }), F.makeHass());
  assert.equal(roles.sun, "sun.sun");
  assert.equal(roles.entity, "weather.jma_chiyoda");
});

test("the card reads the discovered sensor, and the override when there is one", () => {
  const quake = (id) => F.mk(id, "x", { hypocenter: "千葉県北西部", magnitude: 4.6, max_shindo: "3", time: F.iso(3600000) });
  const hass = F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": quake("sensor.jma_chiyoda_last_earthquake") } });
  const a = H.mount({ entity: "weather.jma_chiyoda", mode: "full" }, hass);
  assert.match(H.text(H.q(a, ".drows")), /Last quake.*千葉県北西部/);

  // an override that points at a different sensor: the card shows that one's data
  const own = F.mk("sensor.my_quake", "x", { hypocenter: "茨城県南部", magnitude: 5.1, max_shindo: "4", time: F.iso(7200000) });
  const hass2 = F.makeHass({ states: { "sensor.my_quake": own } });
  const b = H.mount({ entity: "weather.jma_chiyoda", mode: "full", entities: { quake: "sensor.my_quake" } }, hass2);
  assert.match(H.text(H.q(b, ".drows")), /茨城県南部/);
  assert.doesNotMatch(H.text(H.q(b, ".drows")), /千葉県北西部/);
});

test("an area with no sibling sensors still renders the weather part and says nothing about the rest", () => {
  const hass = F.makeHass({ entities: { "weather.jma_solo": { entity_id: "weather.jma_solo", device_id: "dev_solo", platform: "jma", translation_key: "weather" } } });
  hass.states["weather.jma_solo"] = F.mk("weather.jma_solo", "sunny", { ...F.WEATHER_ATTRS, condition: "sunny", jma_name_en: "Sunny" });
  const card = H.mount({ entity: "weather.jma_solo" }, hass);
  assert.match(H.text(H.q(card, ".temp")), /^21/);
  assert.equal(H.q(card, ".chips").hidden, true);
});

test("the card re-renders when hass.entities changes (a sibling enabled later)", () => {
  const hass = F.makeHass();
  delete hass.entities["sensor.jma_chiyoda_last_earthquake"];
  const card = H.mount({ entity: "weather.jma_chiyoda", mode: "full" }, hass);
  assert.doesNotMatch(H.text(H.q(card, ".drows")) || "", /Last quake/);
  const next = F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": F.EXTRA.quake } });
  card.hass = next;
  assert.match(H.text(H.q(card, ".drows")), /Last quake/);
});
