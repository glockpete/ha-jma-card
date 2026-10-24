"use strict";
// Language and time zone from Home Assistant; the temperature unit from the weather entity; WBGT stays in degrees Celsius.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { uiLocale, setLocale, fmtTime, fmtDay, toUnit, tempUnit, nowBlock, timeOnDayEn, FALLBACK_TZ, JST } = H.helpers;
const BASE = "weather.jma_chiyoda";
test.afterEach(() => { H.cleanup(); setLocale("en"); });

const T = new Date("2026-10-01T03:00:00Z");   // 12:00 Tokyo, 23:00 on 30 Sep in New York

test("uiLocale: en stays en-GB, a known language gets Latin digits, an unknown one falls back", () => {
  assert.equal(uiLocale("en"), "en-GB");
  assert.equal(uiLocale(undefined), "en-GB");
  assert.equal(uiLocale(""), "en-GB");
  assert.equal(uiLocale("de"), "de-u-nu-latn");
  assert.equal(uiLocale("ar"), "ar-u-nu-latn");
  assert.equal(uiLocale("zz-not-a-tag-"), "en-GB");
  assert.equal(uiLocale(42), "en-GB");
});

test("fmtDay: the English-side date follows the language; the Japanese weekday never does", () => {
  setLocale("en");
  assert.equal(fmtDay(T, "Asia/Tokyo").md, "1 Oct");
  assert.equal(fmtDay(T, "Asia/Tokyo").full, "Thu 1 Oct");
  assert.equal(fmtDay(T, "Asia/Tokyo").ja, "木");
  setLocale("de");
  assert.match(fmtDay(T, "Asia/Tokyo").md, /^1\.? Okt/);
  assert.equal(fmtDay(T, "Asia/Tokyo").ja, "木");
  setLocale("fr");
  assert.match(fmtDay(T, "Asia/Tokyo").md, /oct/i);
  assert.equal(H.helpers.fmtDay(new Date("2026-09-04T03:00:00Z"), "Asia/Tokyo").md.includes("Sept"), false);
});

test("hass.locale.language reaches the formatters on every hass update", () => {
  const card = H.mount({ entity: BASE }, F.makeHass({ locale: { language: "de" } }));
  assert.match(fmtDay(T, "Asia/Tokyo").md, /Okt/);
  card.hass = F.makeHass({ locale: { language: "en" } });
  assert.equal(fmtDay(T, "Asia/Tokyo").md, "1 Oct");
});

test("fmtTime: 24-hour HH:MM in the zone given, midnight is 00:xx", () => {
  assert.equal(fmtTime(T, "Asia/Tokyo"), "12:00");
  assert.equal(fmtTime(T, "America/New_York"), "23:00");
  assert.equal(fmtTime(T, "Europe/London"), "04:00");
  assert.equal(fmtTime(new Date("2026-09-30T15:05:00Z"), "Asia/Tokyo"), "00:05");
  assert.equal(fmtTime(new Date("nope"), "Asia/Tokyo"), "");
});

test("time zone: hass.config.time_zone is used, Asia/Tokyo only as the last fallback", () => {
  assert.equal(FALLBACK_TZ, "Asia/Tokyo");
  const quake = F.mk("sensor.jma_chiyoda_last_earthquake", "x", { time: T.toISOString(), hypocenter: "A", magnitude: 4, max_shindo: "3" });
  const tokyo = H.mount({ entity: BASE, mode: "full" }, F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": quake } }));
  assert.match(H.text(H.q(tokyo, ".drows")), /10月1日 12:00/);
  assert.equal(tokyo._tz, "Asia/Tokyo");
  const ny = F.makeHass({ states: { "sensor.jma_chiyoda_last_earthquake": quake } });
  ny.config.time_zone = "America/New_York";
  const york = H.mount({ entity: BASE, mode: "full" }, ny);
  assert.equal(york._tz, "America/New_York");
  assert.match(H.text(H.q(york, ".drows")), /9月30日 23:00/);
  const none = F.makeHass();
  delete none.config.time_zone;
  assert.equal(H.mount({ entity: BASE }, none)._tz, "Asia/Tokyo");
  const noConfig = F.makeHass();
  delete noConfig.config;
  assert.equal(H.mount({ entity: BASE }, noConfig)._tz, "Asia/Tokyo");
});

test("the Japan-wide day is JST whatever zone the display uses", () => {
  const cities = [{ name: "A", days: [{ date: "2026-10-01", code: "100" }, { date: "2026-10-02", code: "100" }] }];
  // 2026-10-01 20:00 UTC is 05:00 on the 2nd in Tokyo and 16:00 on the 1st in New York: the answer does not move with the zone
  const now = Date.parse("2026-10-01T20:00:00Z");
  assert.equal(H.helpers.japanDay(cities, now), "2026-10-02");
  assert.equal(JST, "Asia/Tokyo");
});

test("timeOnDayEn: the month name follows the language", () => {
  setLocale("en");
  assert.equal(timeOnDayEn(T, "Asia/Tokyo"), "12:00 on 1 Oct");
  setLocale("de");
  assert.match(timeOnDayEn(T, "Asia/Tokyo"), /^12:00 on 1\.? Okt/);
});

test("toUnit / tempUnit", () => {
  assert.equal(toUnit(24, "°C"), 24);
  assert.ok(Math.abs(toUnit(24, "°F") - 75.2) < 1e-9);
  assert.ok(Math.abs(toUnit(0, "K") - 273.15) < 1e-9);
  assert.equal(toUnit(null, "°F"), null);
  assert.equal(toUnit("x", "°F"), null);
  assert.equal(tempUnit({ temperature_unit: "°F" }), "°F");
  assert.equal(tempUnit({ temperature_unit: "K" }), "K");
  assert.equal(tempUnit({ temperature_unit: "°C" }), "°C");
  assert.equal(tempUnit({}), "°C");
  assert.equal(tempUnit(undefined), "°C");
});

test("nowBlock: the entity's own temperature is shown as it is, JMA's extra Celsius highs and lows are converted", () => {
  const f = nowBlock({ state: "cloudy", attributes: { temperature: 70.5, temperature_unit: "°F", temp_max: 24, temp_min: 17, apparent_temperature: 69.1 } }, true);
  assert.equal(f.temp, "71");
  assert.equal(f.unit, "°F");
  assert.equal(f.hi, "75°");
  assert.equal(f.lo, "63°");
  const c = nowBlock({ state: "cloudy", attributes: { temperature: 21.4, temperature_unit: "°C", temp_max: 24, temp_min: 17 } }, true);
  assert.equal(c.unit, "°C");
  assert.equal(c.hi, "24°");
  assert.equal(c.lo, "17°");
  assert.equal(nowBlock({ state: "unavailable", attributes: {} }).unit, "°C");
});

test("the card shows °F and converts the Celsius extras; the WBGT tile stays in °C", () => {
  const attrs = { ...F.WEATHER_ATTRS, temperature: 70.5, temperature_unit: "°F", apparent_temperature: 69.1, temp_max: 24, temp_min: 17 };
  const hass = F.makeHass({ states: { [BASE]: F.mk(BASE, "cloudy", attrs), "sensor.jma_chiyoda_wbgt": F.EXTRA.wbgt } });
  const compact = H.mount({ entity: BASE }, hass);
  assert.equal(H.text(H.q(compact, ".temp .deg")), "°F");
  assert.equal(H.text(H.q(compact, ".hv")), "75°");
  assert.equal(H.text(H.q(compact, ".lv")), "63°");
  const full = H.mount({ entity: BASE, mode: "full" }, hass);
  const tiles = H.text(H.q(full, ".tiles"));
  assert.match(tiles, /27\.5\s?°C/);
  assert.doesNotMatch(tiles, /27\.5\s?°F/);
});

test("the 7-day bars are drawn in the entity's unit", () => {
  const attrs = { ...F.WEATHER_ATTRS, temperature: 70.5, temperature_unit: "°F", temp_min_observed: 15, temp_max_observed: 20, normal_temp_min: 14, normal_temp_max: 22 };
  const hass = F.makeHass({ states: { [BASE]: F.mk(BASE, "cloudy", attrs) } });
  const card = H.mount({ entity: BASE, mode: "full" }, hass);
  const day = new Date(Math.floor(Date.now() / 86400000) * 86400000);
  card._daily = [0, 1, 2].map((i) => ({ datetime: new Date(day.getTime() + i * 86400000).toISOString(), condition: "cloudy", temperature: 75 + i, templow: 62, temp_max_lower: 22, temp_max_upper: 27, precipitation_probability: 20 }));
  card._render();
  const label = H.text(H.q(card, ".days"));
  assert.match(label, /75°/);
  assert.match(label, /62°/);
  // JMA's range (22-27 C) and the normals (14-22 C) are Celsius attributes: drawn as 72-81 and 57-72 F
  const titles = H.qa(card, ".days [title]").map((n) => n.title);
  assert.ok(titles.includes("JMA range 72°–81°"), titles.join(" | "));
  assert.ok(titles.includes("平年 normal 57°–72°"), titles.join(" | "));
  assert.equal(H.text(H.q(card, ".wkey")), "thin lines = JMA's range · shaded = 平年 normal 57°–72°");
});
