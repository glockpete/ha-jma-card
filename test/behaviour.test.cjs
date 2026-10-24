"use strict";
// Behaviour that must survive the port: a broken section does not take the card down, lightning and alerts stay off until
// configured, the unavailable state, subscriptions only while attached.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const BASE = "weather.jma_chiyoda";
test.afterEach(() => H.cleanup());

test("an unavailable weather entity says so, in the card's own words", () => {
  const hass = F.makeHass({ states: { [BASE]: F.mk(BASE, "unavailable") } });
  const card = H.mount({ entity: BASE }, hass);
  assert.match(H.text(H.q(card, ".cond")), /Couldn't reach JMA weather/);
});

test("a section that throws is skipped and logged once, the rest still renders", () => {
  const warned = [];
  const real = console.warn;
  console.warn = (...a) => warned.push(a.map(String).join(" "));
  try {
    const card = H.mount({ entity: BASE }, F.makeHass());
    // every section reads this getter; it throws, so every section fails inside its own guard
    Object.defineProperty(card, "_full", { get() { throw new Error("boom"); }, configurable: true });
    assert.doesNotThrow(() => { card._render(); card._render(); });
    delete card._full;
    assert.equal(warned.filter((w) => w.includes("boom")).length, 1, "the same message is logged once per card");
    assert.ok(warned[0].startsWith("ha-jma-card:"), warned[0]);
    // the shell, with its credit line, is still there
    assert.match(H.text(H.q(card, ".attr")), /出典：気象庁ホームページ/);
    // and the card works again once the cause is gone
    card._render();
    assert.match(H.text(H.q(card, ".temp")), /^21/);
  } finally { console.warn = real; }
});

test("odd attribute shapes do not throw", () => {
  const states = {
    "sensor.jma_chiyoda_warnings": F.mk("sensor.jma_chiyoda_warnings", "1", { warnings: "none" }),
    "sensor.jma_chiyoda_rain_next_hour": F.mk("sensor.jma_chiyoda_rain_next_hour", "x", { slots: 5, basetime: 12 }),
    "sensor.jma_chiyoda_last_earthquake": F.mk("sensor.jma_chiyoda_last_earthquake", "x", { time: {}, magnitude: "high" }),
    "sensor.jma_chiyoda_tsunami": F.mk("sensor.jma_chiyoda_tsunami", "warning", { home_area: 7, home_height_m: "a" }),
    "sensor.jma_chiyoda_wbgt": F.mk("sensor.jma_chiyoda_wbgt", "hot"),
    "sensor.jma_chiyoda_typhoon": F.mk("sensor.jma_chiyoda_typhoon", "1", { storms: "many" }),
  };
  for (const mode of ["compact", "full"]) {
    const card = H.mount({ entity: BASE, mode }, F.makeHass({ states }));
    assert.match(H.text(H.q(card, ".attr")), /出典：気象庁ホームページ/);
  }
});

test("a sensor that is not there hides its own part and says nothing; one that is unavailable says so", () => {
  const hass = F.makeHass();
  delete hass.entities["sensor.jma_chiyoda_tsunami"];
  const absent = H.mount({ entity: BASE }, hass);
  assert.doesNotMatch(H.text(H.q(absent, ".notices")) || "", /tsunami/i);
  const gone = H.mount({ entity: BASE }, F.makeHass({ states: { "sensor.jma_chiyoda_tsunami": F.mk("sensor.jma_chiyoda_tsunami", "unavailable") } }));
  assert.match(H.text(H.q(gone, ".notices")), /Couldn't reach the tsunami feed/);
  const missingWarnings = F.makeHass();
  delete missingWarnings.states["sensor.jma_chiyoda_warnings"];
  assert.match(H.text(H.q(H.mount({ entity: BASE }, missingWarnings), ".notices")), /Couldn't reach the warnings feed/, "warnings are never read as none");
});

test("the credit links are styled as part of the credit line, not as default blue links", () => {
  const card = H.mount({ entity: BASE }, F.makeHass());
  assert.match(H.q(card, "style").textContent, /\.attr a \{ color: inherit;/);
});

test("lightning: a sensor in hass is ignored until `lightning:` names it", () => {
  const states = {
    "sensor.strikes_distance": F.mk("sensor.strikes_distance", "8", {}),
    "sensor.strikes_azimuth": F.mk("sensor.strikes_azimuth", "90", {}),
  };
  const off = H.mount({ entity: BASE }, F.makeHass({ states }));
  assert.doesNotMatch(H.text(H.q(off, ".notices")), /落雷/);
  const on = H.mount({ entity: BASE, lightning: { distance: "sensor.strikes_distance", azimuth: "sensor.strikes_azimuth" } }, F.makeHass({ states }));
  assert.match(H.text(H.q(on, ".notices")), /落雷 8 km/);
});

test("alert_entity: its advice shows only when named, and only the attributes the card documents are read", () => {
  const advice = F.mk("sensor.my_alert", "alert", { advice: "Move to higher ground.", time: F.iso(60000), test: false, hazard: "tsunami", level: "urgent" });
  const states = { "sensor.my_alert": advice, "sensor.jma_chiyoda_tsunami": F.EXTRA.tsunami };
  const off = H.mount({ entity: BASE }, F.makeHass({ states }));
  assert.doesNotMatch(H.text(H.q(off, ".notices")), /What to do/);
  const on = H.mount({ entity: BASE, alert_entity: "sensor.my_alert" }, F.makeHass({ states }));
  assert.match(H.text(H.q(on, ".notices")), /What to do/);
  assert.match(H.text(H.q(on, ".notices")), /Move to higher ground/);
  // a test alert never shows
  const test_ = F.mk("sensor.my_alert", "alert", { advice: "Drill.", time: F.iso(60000), test: true, hazard: "tsunami" });
  const drill = H.mount({ entity: BASE, alert_entity: "sensor.my_alert" }, F.makeHass({ states: { ...states, "sensor.my_alert": test_ } }));
  assert.doesNotMatch(H.text(H.q(drill, ".notices")), /Drill/);
});

test("forecast subscriptions: opened only while attached, closed on removal", async () => {
  const subs = [];
  const unsubbed = [];
  const hass = F.makeHass({ connection: {
    subscribeMessage: (cb, msg) => { subs.push(msg); return Promise.resolve(() => unsubbed.push(msg.forecast_type)); },
  } });
  const card = document.createElement("ha-jma-card");
  card.setConfig({ entity: BASE });
  card.hass = hass;                       // detached: no subscription
  assert.equal(subs.length, 0);
  document.body.appendChild(card);        // attached: daily and hourly
  assert.deepEqual(subs.map((s) => s.forecast_type).sort(), ["daily", "hourly"]);
  assert.ok(subs.every((s) => s.type === "weather/subscribe_forecast" && s.entity_id === BASE));
  card.remove();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(unsubbed.sort(), ["daily", "hourly"]);
});

test("card size hints for the dashboard grid", () => {
  const compact = H.mount({ entity: BASE }, F.makeHass());
  const full = H.mount({ entity: BASE, mode: "full" }, F.makeHass());
  assert.ok(full.getCardSize() > compact.getCardSize());
  assert.deepEqual(compact.getGridOptions(), { columns: 12, min_columns: 6 });
});

test("the toggle opens the drop-down and remembers it", () => {
  const card = H.mount({ entity: BASE }, F.makeHass());
  assert.equal(H.q(card, ".more").hidden, true);
  H.q(card, ".toggle").click();
  assert.equal(H.q(card, ".more").hidden, false);
  assert.equal(H.q(card, ".toggle").getAttribute("aria-expanded"), "true");
  assert.equal(localStorage.getItem("ha-jma-card:open"), "1");
});

test("the title and icon header appear only when set; text goes in as text", () => {
  const plain = H.mount({ entity: BASE }, F.makeHass());
  assert.equal(H.q(plain, ".chead").hidden, true);
  const titled = H.mount({ entity: BASE, title: "<b>Chiyoda</b>", icon: "mdi:weather-cloudy" }, F.makeHass());
  assert.equal(H.q(titled, ".chead").hidden, false);
  assert.equal(H.q(titled, ".cht").textContent, "<b>Chiyoda</b>");
  assert.equal(H.qa(titled, ".cht b").length, 0);
});
