"use strict";
// 0.13.2 layout (from the hostile design review of the full page): section order, the warning list row, the Now tiles,
// Japanese-first dates and the wide breakpoint.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const BASE = "weather.jma_chiyoda";
test.afterEach(() => H.cleanup());

test("full mode: 台風 and 全国 come after 週間予報, the place's own forecast first", () => {
  const card = H.mount({ entity: BASE, mode: "full" }, F.makeHass());
  const order = H.qa(card, "section").map((s) => s.className.split(" ")[0]);
  const at = (name) => order.indexOf(name);
  for (const name of ["hourly", "week", "typhoon", "japan"]) assert.ok(at(name) >= 0, `${name} in ${order}`);
  assert.ok(at("hourly") < at("week") && at("week") < at("typhoon") && at("typhoon") < at("japan"), order.join(","));
});

test("a warning row is a dot in the level colour and the name in ink; the filled chip is not drawn again", () => {
  const w = { level: 3, code: "03", name_ja: "大雨警報", name_en: "Heavy rain warning", status: "発表" };
  const hass = F.makeHass({ states: {
    "sensor.jma_chiyoda_warnings": F.mk("sensor.jma_chiyoda_warnings", "3", { warnings: [w], area_missing: false }) } });
  const card = H.mount({ entity: BASE, mode: "full" }, hass);
  const row = H.q(card, ".wlist .wrow");
  assert.ok(row, "a row for the warning");
  const dot = row.querySelector(".wdot");
  assert.ok(dot && dot.style.background, "the dot carries the level colour");
  assert.match(H.text(row.querySelector(".wname")), /大雨警報/);
  assert.equal(row.querySelector(".wchip"), null);
});

test("Now tiles: 'Peak gust' replaces 'Max gust today', and Observed is a row under the tiles, not a tile", () => {
  const attrs = { ...F.WEATHER_ATTRS, gust_max_today: 12.3, wind_speed_unit: "m/s", station_primary: "44132" };
  const hass = F.makeHass({ states: { [BASE]: F.mk(BASE, "cloudy", attrs) } });
  const card = H.mount({ entity: BASE, mode: "full" }, hass);
  const labels = H.qa(card, ".tiles .tile .tl").map(H.text);
  assert.ok(labels.includes("Peak gust"), labels.join("|"));
  assert.ok(!labels.some((l) => /Max gust|Observed/.test(l)), labels.join("|"));
  assert.ok(!labels.some((l) => l.includes(" · ")), `the station is not repeated in tile labels: ${labels.join("|")}`);
  const rows = H.qa(card, ".drows .drow").map(H.text);
  const observed = rows.find((r) => r.startsWith("Observed"));
  assert.ok(observed && /AMeDAS Tokyo \(44132\)/.test(observed), rows.join("|"));
});

test("全国 day tabs and weekly dates are Japanese-first", () => {
  const { japanDayLabel, fmtDay } = H.helpers;
  assert.equal(japanDayLabel("2026-10-25", "2026-10-25"), "今日 10月25日");
  assert.equal(japanDayLabel("2026-10-26", "2026-10-25"), "明日 10月26日");
  assert.match(japanDayLabel("2026-10-27", "2026-10-25"), /^火 10月27日$/);
  assert.equal(fmtDay(new Date("2026-10-01T03:00:00Z"), "Asia/Tokyo").jmd, "10月1日");
  assert.equal(fmtDay(new Date("x"), "Asia/Tokyo").jmd, "");
});

test("the wide two-column layout starts at 880 px", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "ha-jma-card.js"), "utf8");
  assert.match(src, /const WIDE_AT = 880;/);
  assert.match(src, /minmax\(0, 1\.25fr\) minmax\(420px, 1fr\)/);
  assert.match(src, /ha-card\.full \.tiles \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
});
