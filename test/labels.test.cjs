"use strict";
// Generic zoom labels; quake and tsunami wording from the sensors' own attributes.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { quakeLine, tsunamiNotices, NBSP } = H.helpers;
const BASE = "weather.jma_chiyoda";
test.afterEach(() => H.cleanup());

const st = (attrs, state = "x") => ({ state, attributes: attrs });
const QUAKE_TIME = "2026-10-01T03:00:00Z";   // 12:00 in Tokyo

test("zoom buttons: Local, Area, Region, Japan by default", () => {
  const card = H.mount({ entity: BASE, mode: "full" }, F.makeHass());
  const labels = H.qa(card, ".zooms button").map((b) => b.textContent);
  assert.deepEqual(labels, ["Local", "Area", "Region", "Japan"]);
  assert.deepEqual(H.qa(card, ".zooms button").map((b) => b.title), ["about 15 km across", "about 60 km across", "about 250 km across", "about 3000 km across"]);
});

test("zoom buttons: zoom_labels and spans replace them", () => {
  const card = H.mount({ entity: BASE, mode: "full", spans: [10, 40], zoom_labels: ["Street"] }, F.makeHass());
  assert.deepEqual(H.qa(card, ".zooms button").map((b) => b.textContent), ["Street", "40 km"]);
});

test("the full card carries no place name of its own in its static text (a region, a city, a district, a house)", () => {
  const hass = F.makeHass();
  hass.states[BASE] = F.mk(BASE, "cloudy", { ...F.WEATHER_ATTRS, station_primary_name: "", friendly_name: "JMA" });
  const card = H.mount({ entity: BASE, mode: "full" }, hass);
  const all = H.text(H.q(card, "ha-card")) + H.qa(card, "[title]").map((n) => n.title).join(" ");
  for (const word of [["Kan", "to"], ["Tok", "yo"], ["Ne", "ar"], ["ho", "use"]].map((p) => p.join(""))) {
    assert.ok(!all.includes(word), word);
  }
});

test("quakeLine: area, area shindo, then the local place from the attributes", () => {
  const line = quakeLine(st({
    time: QUAKE_TIME, hypocenter: "千葉県北西部", magnitude: 4.6, max_shindo: "3",
    area: "東京都２３区", area_shindo: "2", local_name: "千代田区", local_shindo: "1",
  }), "Asia/Tokyo");
  assert.equal(line, "10月1日 12:00 · 千葉県北西部 · M4.6 · 最大震度3 · 東京都２３区 震度2 · 千代田区 震度1");
});

test("quakeLine: the prefecture stands in for a missing area; a missing local place is left out", () => {
  const withPref = quakeLine(st({ time: QUAKE_TIME, hypocenter: "茨城県南部", magnitude: 5, max_shindo: "4", pref: "東京都", pref_shindo: "3" }), "Asia/Tokyo");
  assert.equal(withPref, "10月1日 12:00 · 茨城県南部 · M5.0 · 最大震度4 · 東京都 震度3");
  const bare = quakeLine(st({ time: QUAKE_TIME, hypocenter: "茨城県南部", magnitude: 5, max_shindo: "4" }), "Asia/Tokyo");
  assert.equal(bare, "10月1日 12:00 · 茨城県南部 · M5.0 · 最大震度4");
  const localOnly = quakeLine(st({ time: QUAKE_TIME, hypocenter: "x", magnitude: 3, max_shindo: "2", local_shindo: "1" }), "Asia/Tokyo");
  assert.match(localOnly, / · 地点 震度1$/);
  assert.equal(quakeLine(st({}, "unknown"), "Asia/Tokyo"), "–");
  assert.equal(quakeLine(null, "Asia/Tokyo"), "");
});

test("quake row on the card shows the sensor's names", () => {
  const card = H.mount({ entity: BASE, mode: "full" }, F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": F.EXTRA.quake } }));
  const row = H.text(H.q(card, ".drows"));
  assert.match(row, /東京都２３区 震度2 · 千代田区 震度1/);
  const other = F.mk("sensor.jma_chiyoda_last_earthquake", "x", { time: F.iso(3600000), hypocenter: "A", magnitude: 4, max_shindo: "3", area: "Example Area", area_shindo: "1", local_name: "Example Ward", local_shindo: "0" });
  card.hass = F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": other } });
  assert.match(H.text(H.q(card, ".drows")), /Example Area 震度1 · Example Ward 震度0/);
});

test("tsunami: the area in the line is the sensor's home_area", () => {
  const [n] = tsunamiNotices(st({ home_area: "東京湾内湾", home_height: "高い" }, "warning"), "Asia/Tokyo", Date.now());
  assert.equal(n.kind, "tsunami");
  assert.equal(n.parts[0].text, "Tsunami warning");
  assert.equal(n.parts[1].text, "·" + NBSP + "東京湾内湾");
  assert.equal(n.detail, "high");
  assert.equal(n.title, "津波警報 東京湾内湾");
  const [m] = tsunamiNotices(st({ home_area: "Example Bay" }, "major_warning"), "Asia/Tokyo", Date.now());
  assert.equal(m.parts[1].text, "·" + NBSP + "Example" + NBSP + "Bay");
});

test("tsunami: no home_area, no area in the line; an advisory and the elsewhere line use the same attribute", () => {
  const [a] = tsunamiNotices(st({}, "watch"), "Asia/Tokyo", Date.now());
  assert.equal(a.parts.length, 1);
  assert.equal(a.parts[0].text, "Tsunami advisory");
  assert.equal(tsunamiNotices(st({ home_area: "   " }, "warning"), "Asia/Tokyo", Date.now())[0].parts.length, 1);
  const [e] = tsunamiNotices(st({ max_grade: "warning", home_area: "Example Bay", counts: { warning: 2 } }, "none"), "Asia/Tokyo", Date.now());
  assert.equal(e.kind, "tsunamijp");
  assert.equal(e.parts[1].text, "·" + NBSP + "not" + NBSP + "Example" + NBSP + "Bay");
  assert.equal(e.detail, "2 areas");
  assert.deepEqual(tsunamiNotices(st({}, "none"), "Asia/Tokyo", Date.now()), []);
  assert.deepEqual(tsunamiNotices(st({}, "unavailable"), "Asia/Tokyo", Date.now()), []);
});

test("tsunami line on the card", () => {
  const card = H.mount({ entity: BASE }, F.makeHass({ states: { "sensor.jma_chiyoda_tsunami": F.EXTRA.tsunami } }));
  const notices = H.text(H.q(card, ".notices")).replace(new RegExp(NBSP, "g"), " ");
  assert.match(notices, /Tsunami warning · 東京湾内湾/);
  const moved = F.mk("sensor.jma_chiyoda_tsunami", "warning", { home_area: "Example Bay" });
  card.hass = F.makeHass({ states: { "sensor.jma_chiyoda_tsunami": moved } });
  const after = H.text(H.q(card, ".notices")).replace(new RegExp(NBSP, "g"), " ");
  assert.match(after, /Tsunami warning · Example Bay/);
  assert.doesNotMatch(after, /東京湾内湾/);
});
