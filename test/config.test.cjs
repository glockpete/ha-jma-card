"use strict";
// setConfig validation, the defaults, getStubConfig, the optional parts that stay off until configured, navigate.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { normaliseConfig, DEFAULTS, LIGHTNING_DEFAULTS, ENTITY_ROLES } = H.helpers;
test.afterEach(() => H.cleanup());

const throwsWith = (cfg, re) => assert.throws(() => normaliseConfig(cfg), (e) => e instanceof Error && re.test(e.message), JSON.stringify(cfg));

test("setConfig: the entity is required and must be a weather entity", () => {
  throwsWith(undefined, /mapping/);
  throwsWith([], /mapping/);
  throwsWith({}, /set `entity`/);
  throwsWith({ entity: "" }, /set `entity`/);
  throwsWith({ entity: 5 }, /set `entity`/);
  throwsWith({ entity: "sensor.jma_chiyoda_wbgt" }, /weather entity/);
  throwsWith({ entity: "Weather.Jma" }, /weather entity/);
  assert.equal(normaliseConfig({ entity: "weather.jma_chiyoda" }).entity, "weather.jma_chiyoda");
});

test("setConfig: each option is checked, and the message names it", () => {
  const e = "weather.jma_chiyoda";
  throwsWith({ entity: e, mode: "wide" }, /mode must be compact or full/);
  throwsWith({ entity: e, title: 3 }, /`title` must be text/);
  throwsWith({ entity: e, square: "yes" }, /`square` must be true or false/);
  throwsWith({ entity: e, show_radar: 1 }, /`show_radar`/);
  throwsWith({ entity: e, zoom: 99 }, /`zoom`/);
  throwsWith({ entity: e, hours: 0 }, /`hours`/);
  throwsWith({ entity: e, hours: 2.5 }, /`hours`/);
  throwsWith({ entity: e, spans: [] }, /`spans`/);
  throwsWith({ entity: e, spans: [15, "far"] }, /`spans`/);
  throwsWith({ entity: e, zoom_labels: [1] }, /`zoom_labels`/);
  throwsWith({ entity: e, home: [35.68] }, /`home`/);
  throwsWith({ entity: e, entities: [] }, /`entities` must be a mapping/);
  throwsWith({ entity: e, entities: { bogus: "sensor.x_y" } }, /unknown key entities\.bogus/);
  throwsWith({ entity: e, entities: { wbgt: "not an id" } }, /entities\.wbgt must be an entity id/);
  throwsWith({ entity: e, lightning: { speed: "sensor.a_b" } }, /unknown key lightning\.speed/);
  throwsWith({ entity: e, lightning: { distance: "nope" } }, /lightning\.distance must be an entity id/);
  throwsWith({ entity: e, lightning: { minutes: -5 } }, /lightning\.minutes/);
  throwsWith({ entity: e, alert_entity: "nope" }, /`alert_entity`/);
});

test("setConfig: a bad configuration throws from the element and keeps the old one", () => {
  const card = document.createElement("ha-jma-card");
  card.setConfig({ entity: "weather.jma_chiyoda", title: "Chiyoda" });
  assert.throws(() => card.setConfig({ entity: "weather.jma_chiyoda", mode: "nope" }), /ha-jma-card: mode/);
  assert.equal(card._config.title, "Chiyoda");
});

test("defaults: no entity ids, optional parts off", () => {
  const c = normaliseConfig({ entity: "weather.jma_chiyoda" });
  assert.deepEqual(c.entities, {});
  assert.deepEqual(c.lightning, { distance: "", azimuth: "", counter: "", ...LIGHTNING_DEFAULTS });
  assert.equal(c.alert_entity, "");
  assert.equal(c.navigate, "");
  assert.equal(c.mode, "compact");
  assert.equal(c.show_radar, true);
  assert.deepEqual(c.zoom_labels, ["Local", "Area", "Region", "Japan"]);
  // no default carries an entity id: an id in DEFAULTS would only fit one install
  const ids = JSON.stringify(DEFAULTS).match(/[a-z_]+\.[a-z0-9_]+/g) || [];
  assert.deepEqual(ids, []);
});

test("setConfig: Home Assistant's own keys pass through and every entity override is accepted", () => {
  const cfg = { type: "custom:ha-jma-card", grid_options: { rows: 4 }, entity: "weather.jma_chiyoda",
    entities: Object.fromEntries(ENTITY_ROLES.map((r) => [r, `sensor.test_${r}`])) };
  const c = normaliseConfig(cfg);
  assert.equal(Object.keys(c.entities).length, ENTITY_ROLES.length);
});

test("getStubConfig: the first JMA weather entity of the registry, not another integration's", () => {
  const stub = H.Card.getStubConfig(F.makeHass());
  assert.deepEqual(stub, { entity: "weather.jma_chiyoda" });
  // the entity with a state wins over one without
  const hass = F.makeHass();
  delete hass.states["weather.jma_chiyoda"];
  assert.equal(H.Card.getStubConfig(hass).entity, "weather.jma_osaka");
  // nothing from ha-jma installed
  const none = F.makeHass();
  for (const id of Object.keys(none.entities)) if (none.entities[id].platform === "jma") delete none.entities[id];
  assert.deepEqual(H.Card.getStubConfig(none), { entity: "" });
  assert.deepEqual(H.Card.getStubConfig(undefined), { entity: "" });
  // the stub is a configuration the card accepts once an entity is found
  assert.doesNotThrow(() => normaliseConfig(H.Card.getStubConfig(F.makeHass())));
});

test("the stub with no ha-jma entity (entity: \"\") shows what to add instead of throwing; no other bad entity does", () => {
  const none = F.makeHass();
  for (const id of Object.keys(none.entities)) if (none.entities[id].platform === "jma") delete none.entities[id];
  const subs = [];
  none.connection = { subscribeMessage: (cb, msg) => { subs.push(msg); return Promise.resolve(() => {}); } };
  const stub = H.Card.getStubConfig(none);
  assert.deepEqual(stub, { entity: "" });

  const card = H.mount(stub, none);       // setConfig(stub), attached, then hass: what the card picker's preview does
  assert.match(H.text(H.q(card, "ha-card.setup .state")), /^Add a JMA weather entity/);
  assert.equal(H.q(card, ".temp"), null, "none of the weather card is built");
  assert.doesNotMatch(H.text(card.shadowRoot.querySelector("ha-card")), /Couldn't reach/);
  assert.equal(subs.length, 0, "nothing is subscribed to");
  assert.equal(card._config, null);
  assert.equal(card.getCardSize(), 6);

  // an entity chosen afterwards builds the real card in the same element
  card.setConfig({ entity: "weather.jma_chiyoda" });
  card.hass = F.makeHass({ connection: none.connection });
  assert.equal(H.q(card, "ha-card.setup"), null);
  assert.match(H.text(H.q(card, ".temp")), /^21/);
  assert.equal(subs.length, 2, "daily and hourly, now that there is an entity");

  // and back to the stub (the entity was cleared): the weather card is replaced, not left behind
  card.setConfig(stub);
  assert.match(H.text(H.q(card, "ha-card.setup .state")), /^Add a JMA weather entity/);
  assert.equal(H.q(card, ".temp"), null);
  card.hass = F.makeHass();
  assert.equal(H.q(card, ".temp"), null, "a hass update does not draw a card without a configuration");
  assert.doesNotThrow(() => card.remove());

  // only the empty-entity stub is let through
  const other = document.createElement("ha-jma-card");
  assert.throws(() => other.setConfig({}), /set `entity`/);
  assert.throws(() => other.setConfig({ entity: 5 }), /set `entity`/);
  assert.throws(() => other.setConfig({ entity: null }), /set `entity`/);
  assert.throws(() => other.setConfig({ entity: "sensor.jma_chiyoda_wbgt" }), /weather entity/);
  assert.throws(() => other.setConfig(undefined), /mapping/);
  assert.throws(() => other.setConfig([]), /mapping/);
  assert.throws(() => normaliseConfig({ entity: "" }), /set `entity`/, "the validator itself stays strict");
});

test("getConfigElement: the editor element", () => {
  const ed = H.Card.getConfigElement();
  assert.equal(ed.localName, "ha-jma-card-editor");
  assert.ok(ed instanceof H.Editor);
});

test("elements and picker entry are registered under the new names", () => {
  assert.equal(customElements.get("ha-jma-card"), H.Card);
  assert.equal(H.Card.name, "HaJmaCard");
  const entry = window.customCards.find((c) => c.type === "ha-jma-card");
  assert.equal(entry.name, "JMA Weather Card (Unofficial)");
  assert.equal(entry.preview, true);
  assert.match(entry.description, /ha-jma/);
});

test("lightning and the alert entity are off until configured", () => {
  const card = H.mount({ entity: "weather.jma_chiyoda" }, F.makeHass());
  const roles = card._roles();
  assert.equal(roles.lightning_distance, null);
  assert.equal(roles.lightning_counter, null);
  assert.equal(roles.alert_latest, null);
  const on = H.mount({ entity: "weather.jma_chiyoda", alert_entity: "sensor.my_alert", lightning: { counter: "sensor.strikes_counter" } }, F.makeHass());
  assert.equal(on._roles().alert_latest, "sensor.my_alert");
  assert.equal(on._roles().lightning_counter, "sensor.strikes_counter");
});

test("navigate: no default, so the radar is not a link; with it, a tap opens the path", () => {
  // jsdom's own history and window: the path is read back from location, the event from a listener on window
  const events = [];
  window.addEventListener("location-changed", (ev) => events.push(ev));
  const off = H.mount({ entity: "weather.jma_chiyoda" }, F.makeHass());
  assert.equal(H.q(off, "ha-card").classList.contains("nav"), false);
  assert.equal(H.q(off, ".radar").getAttribute("tabindex"), null);
  const entries = history.length;
  H.q(off, ".radar").click();
  assert.equal(location.pathname, "/");
  assert.equal(history.length, entries, "nothing pushed");
  assert.equal(events.length, 0);

  const on = H.mount({ entity: "weather.jma_chiyoda", navigate: "/dashboard-weather/forecast" }, F.makeHass());
  assert.equal(H.q(on, "ha-card").classList.contains("nav"), true);
  assert.equal(H.q(on, ".radar").getAttribute("role"), "button");
  H.q(on, ".radar").click();
  assert.equal(location.pathname, "/dashboard-weather/forecast");
  assert.equal(history.length, entries + 1, "one entry pushed");
  assert.equal(events.at(-1).type, "location-changed");
  assert.deepEqual(events.at(-1).detail, { replace: false });
});

test("localStorage keys are namespaced ha-jma-card:", () => {
  const card = H.mount({ entity: "weather.jma_chiyoda" }, F.makeHass());
  H.q(card, ".toggle").click();
  const keys = Object.keys(localStorage);
  assert.ok(keys.length > 0);
  assert.ok(keys.every((k) => k.startsWith("ha-jma-card:")), keys.join(","));
  assert.equal(localStorage.getItem("ha-jma-card:open"), "1");
});
