"use strict";
// The credit line: JMA's is always on the card (every mode, the closed square card, no data); the others only while their data is shown.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { attributionCredits, CREDITS } = H.helpers;
test.afterEach(() => H.cleanup());

const JMA = "出典：気象庁ホームページ";
const EDITED = "気象庁の情報を加工して作成";
const credit = (card) => H.text(H.q(card, ".attr"));
const BASE = "weather.jma_chiyoda";

test("attributionCredits: JMA and the edited statement come first and need no input", () => {
  const ids = attributionCredits({}).map((c) => c.id);
  assert.deepEqual(ids, ["jma", "edited"]);
  assert.deepEqual(attributionCredits(undefined).map((c) => c.id), ["jma", "edited"]);
  assert.match(CREDITS.jma.text, /^出典：気象庁ホームページ/);
  assert.equal(CREDITS.edited.text, EDITED);
  const all = attributionCredits({ map: 1, openMeteo: 1, wbgt: 1, p2p: 1, lightning: 1 }).map((c) => c.id);
  assert.deepEqual(all, ["jma", "edited", "map", "openmeteo", "wbgt", "p2p", "blitz"]);
});

test("attributionCredits: links carry an address, the source texts carry none of the data's own claims", () => {
  for (const c of attributionCredits({ map: 1, openMeteo: 1, wbgt: 1, p2p: 1, lightning: 1 })) {
    if (c.href) assert.match(c.href, /^https:\/\//, c.id);
  }
  assert.equal(CREDITS.openmeteo.href, "https://open-meteo.com/");
  assert.match(CREDITS.wbgt.text, /環境省/);
  assert.equal(CREDITS.blitz.text, "Blitzortung.org");
});

test("the shell carries the JMA credit before any data arrives", () => {
  const card = document.createElement("ha-jma-card");
  card.setConfig({ entity: BASE });
  document.body.appendChild(card);
  // no hass yet: the card has rendered nothing, so the shell is not built; give it an empty hass
  card.hass = { states: {}, entities: {}, locale: { language: "en" }, config: { time_zone: "Asia/Tokyo" }, themes: { darkMode: false } };
  assert.ok(credit(card).includes(JMA), credit(card));
  assert.ok(credit(card).includes(EDITED));
  H.cleanup();
});

for (const mode of ["compact", "full"]) {
  test(`${mode}: JMA credit and the edited statement are visible with data`, () => {
    const card = H.mount({ entity: BASE, mode }, F.makeHass());
    assert.ok(credit(card).includes(JMA));
    assert.ok(credit(card).includes(EDITED));
    assert.equal(H.q(card, ".attr").hidden, false);
  });

  test(`${mode}: JMA credit stays when the weather entity is gone`, () => {
    const hass = F.makeHass();
    delete hass.states[BASE];
    const card = H.mount({ entity: BASE, mode }, hass);
    assert.ok(credit(card).includes(JMA));
    assert.ok(credit(card).includes(EDITED));
  });
}

test("square mode, closed: the credit line is on the card and no rule hides it", () => {
  const card = H.mount({ entity: BASE, square: true }, F.makeHass());
  const shell = H.q(card, "ha-card");
  assert.equal(shell.classList.contains("square"), true);
  assert.equal(shell.classList.contains("open"), false);
  assert.ok(credit(card).includes(JMA));
  assert.ok(credit(card).includes(EDITED));
  const css = H.text(H.q(card, "style")) || H.q(card, "style").textContent;
  assert.doesNotMatch(css, /square:not\(\.open\)\s+\.attr/);
  assert.doesNotMatch(css, /\.attr\s*\{[^}]*display:\s*none/);
});

test("square mode: still there after the drop-down is opened and closed", () => {
  const card = H.mount({ entity: BASE, square: true }, F.makeHass());
  H.q(card, ".toggle").click();
  assert.equal(H.q(card, "ha-card").classList.contains("open"), true);
  assert.ok(credit(card).includes(JMA));
  H.q(card, ".toggle").click();
  assert.equal(H.q(card, "ha-card").classList.contains("open"), false);
  assert.ok(credit(card).includes(JMA));
});

test("the JMA credit links to JMA and opens safely", () => {
  const card = H.mount({ entity: BASE }, F.makeHass());
  const a = H.qa(card, ".attr a")[0];
  assert.equal(a.getAttribute("href"), "https://www.jma.go.jp/bosai/");
  assert.equal(a.getAttribute("target"), "_blank");
  assert.match(a.getAttribute("rel"), /noopener/);
});

test("Open-Meteo: credited while the feels-like figure is shown, not when nothing from it is", () => {
  const withFeels = H.mount({ entity: BASE }, F.makeHass());
  assert.ok(credit(withFeels).includes("Weather data by Open-Meteo.com"), credit(withFeels));
  const link = H.qa(withFeels, ".attr a").find((x) => x.getAttribute("href") === "https://open-meteo.com/");
  assert.ok(link);

  const attrs = { ...F.WEATHER_ATTRS };
  delete attrs.apparent_temperature;
  attrs.attribution = "出典：気象庁ホームページ";
  const hass = F.makeHass({ states: { [BASE]: F.mk(BASE, "cloudy", attrs) } });
  const without = H.mount({ entity: BASE }, hass);
  assert.ok(credit(without).includes(JMA));
  assert.ok(!credit(without).includes("Open-Meteo"), credit(without));
});

test("Open-Meteo: credited in the full card while the hourly strip has rows", () => {
  const attrs = { ...F.WEATHER_ATTRS };
  delete attrs.apparent_temperature;
  const hass = F.makeHass({ states: { [BASE]: F.mk(BASE, "cloudy", attrs) } });
  const card = H.mount({ entity: BASE, mode: "full" }, hass);
  assert.ok(!credit(card).includes("Open-Meteo"), "no rows yet");
  card._hourly = F.hourly(6);
  card._render();
  assert.ok(credit(card).includes("Weather data by Open-Meteo.com"), credit(card));
  card._hourly = [];
  card._render();
  assert.ok(!credit(card).includes("Open-Meteo"), credit(card));
});

test("環境省: only while the WBGT figure is shown", () => {
  const off = H.mount({ entity: BASE, mode: "full" }, F.makeHass());
  assert.ok(!credit(off).includes("環境省"), credit(off));
  const on = H.mount({ entity: BASE, mode: "full" }, F.makeHass({ states: { "sensor.jma_chiyoda_wbgt": F.EXTRA.wbgt } }));
  assert.ok(credit(on).includes("環境省"), credit(on));
  const unav = H.mount({ entity: BASE, mode: "full" }, F.makeHass({ states: { "sensor.jma_chiyoda_wbgt": F.mk("sensor.jma_chiyoda_wbgt", "unavailable") } }));
  assert.ok(!credit(unav).includes("環境省"), credit(unav));
});

test("Blitzortung.org: only when lightning is configured and its sensor exists", () => {
  const none = H.mount({ entity: BASE }, F.makeHass());
  assert.ok(!credit(none).includes("Blitzortung"));
  const configured = H.mount({ entity: BASE, lightning: { counter: "sensor.strikes_counter" } }, F.makeHass());
  assert.ok(!credit(configured).includes("Blitzortung"), "named but absent");
  const live = H.mount({ entity: BASE, lightning: { counter: "sensor.strikes_counter" } }, F.makeHass({ states: { "sensor.strikes_counter": F.EXTRA.lightningCounter } }));
  assert.ok(credit(live).includes("Blitzortung.org"), credit(live));
});

test("P2P地震情報: only while a quake line or a tsunami line is shown", () => {
  const off = H.mount({ entity: BASE, mode: "full" }, F.makeHass());
  assert.ok(!credit(off).includes("P2P"), credit(off));
  const quake = H.mount({ entity: BASE, mode: "full" }, F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": F.EXTRA.quake } }));
  assert.ok(credit(quake).includes("P2P地震情報"), credit(quake));
});

test("map credit: with the radar, not when the compact radar is hidden (the default base map is GSI's)", () => {
  const GSI = "出典：国土地理院（地理院タイル）";
  const withMap = H.mount({ entity: BASE }, F.makeHass());
  assert.ok(credit(withMap).includes(GSI), credit(withMap));
  const noMap = H.mount({ entity: BASE, show_radar: false }, F.makeHass());
  assert.ok(!credit(noMap).includes("国土地理院"), credit(noMap));
  assert.ok(credit(noMap).includes(JMA));
  const full = H.mount({ entity: BASE, mode: "full", show_radar: false }, F.makeHass());
  assert.ok(credit(full).includes(GSI), "the full card always draws the map");
});

test("the credit line follows the data: a quake sensor that goes away takes its credit with it", () => {
  const card = H.mount({ entity: BASE, mode: "full" }, F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": F.EXTRA.quake } }));
  assert.ok(credit(card).includes("P2P"));
  card.hass = F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": F.mk("sensor.jma_chiyoda_last_earthquake", "unavailable") } });
  assert.ok(!credit(card).includes("P2P"), credit(card));
  assert.ok(credit(card).includes(JMA));
});
