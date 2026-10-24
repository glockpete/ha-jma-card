"use strict";
// The base map: `base_map` (gsi by default, osm, esri, or a custom https tile URL); its tile addresses, its label layer, the
// credit line (only the active provider's), the dark filter, the editor control and the documents that quote the terms.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { normaliseConfig, DEFAULTS, BASE_MAPS, BASE_MAP_IDS, DEFAULT_BASE_MAP, resolveBaseMap, baseMapCredit, attributionCredits,
  CREDITS, EDITOR_SCHEMA, EDITOR_LABELS, editorData, cleanEditorConfig } = H.helpers;
test.afterEach(() => H.cleanup());

const BASE = "weather.jma_chiyoda";
const E = { entity: BASE };
const GSI_CREDIT = "出典：国土地理院（地理院タイル）";
const ICHIRAN = "https://maps.gsi.go.jp/development/ichiran.html";
const CUSTOM = "https://tiles.example.org/{z}/{x}/{y}.png";
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const throwsWith = (cfg, re) => assert.throws(() => normaliseConfig(cfg), (e) => e instanceof Error && re.test(e.message), JSON.stringify(cfg));
const credit = (card) => H.text(H.q(card, ".attr"));
const srcs = (card, sel) => H.qa(card, sel).map((i) => i.getAttribute("src"));

/** A compact card with the radar drawn at 480x320 (jsdom does no layout); zoom 10 over Tokyo Station is tile 909/403. */
function drawn(config, dark = false, mode = "compact") {
  const card = H.mount({ ...E, mode, ...config }, F.makeHass({ themes: { darkMode: dark } }));
  H.size(H.q(card, ".radar"), 480, 320);
  card._width = 480; card._height = 320;
  card._radarKey = ""; card._baseKey = "";
  card._renderRadar();
  return card;
}

// ------------------------------------------------------------------ the table and the default

test("the default base map is GSI pale: no key, no label layer, native zoom to 18", () => {
  assert.equal(DEFAULT_BASE_MAP, "gsi");
  assert.equal(DEFAULTS.base_map, "gsi");
  assert.equal(normaliseConfig(E).base_map, "gsi");
  assert.equal(normaliseConfig({ ...E, base_map: null }).base_map, "gsi");
  assert.deepEqual(BASE_MAP_IDS, ["gsi", "osm", "esri"]);
  const m = resolveBaseMap(undefined);
  assert.equal(m.id, "gsi");
  assert.equal(m.url, "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png");
  assert.equal(m.labelUrl, "");
  assert.equal(m.maxZoom, 18);
});

test("each choice has its tile template, zoom limit and credit", () => {
  assert.deepEqual(
    BASE_MAP_IDS.map((id) => [id, BASE_MAPS[id].url, BASE_MAPS[id].labelUrl, BASE_MAPS[id].maxZoom]),
    [
      ["gsi", "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", "", 18],
      ["osm", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "", 19],
      ["esri", "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", 16],
    ]);
  assert.equal(baseMapCredit("gsi").text, GSI_CREDIT);
  assert.equal(baseMapCredit("gsi").href, ICHIRAN);
  assert.equal(baseMapCredit("osm").text, "© OpenStreetMap contributors");
  assert.equal(baseMapCredit("osm").href, "https://www.openstreetmap.org/copyright");
  assert.equal(baseMapCredit("esri").text, "Esri, HERE, Garmin, © OpenStreetMap contributors");
  for (const id of BASE_MAP_IDS) {
    assert.equal(baseMapCredit(id).id, "map");
    assert.ok(BASE_MAPS[id].terms.startsWith("https://"), id);
    assert.equal(normaliseConfig({ ...E, base_map: id }).base_map, id);
  }
  // the Esri host is in the esri row and nowhere else in the card
  assert.deepEqual(BASE_MAP_IDS.filter((id) => /arcgis/i.test(JSON.stringify(BASE_MAPS[id]))), ["esri"]);
  const src = read("ha-jma-card.js");
  const start = src.indexOf("const BASE_MAPS = {");
  const end = src.indexOf("\n};\n", start);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(src.slice(0, start) + src.slice(end), /arcgisonline/i);
  assert.equal(CREDITS.map, undefined, "the map credit is the active base map's, not a fixed entry");
});

test("GSI's required credit: the text names 国土地理院 and links to the tile list; the shoreline notice for low zooms is in the tooltip", () => {
  const c = baseMapCredit("gsi");
  assert.match(c.text, /国土地理院/);
  assert.equal(c.href, ICHIRAN);
  assert.match(c.title, /Vector Map Level 0/);
});

// ------------------------------------------------------------------ tiles on the card

test("default: the base tiles come from GSI (compact zoom 10 over Tokyo Station is tile 909/403), with no label layer", () => {
  const card = drawn({ zoom: 10 });
  const base = srcs(card, ".base img");
  assert.ok(base.length > 0);
  assert.ok(base.includes("https://cyberjapandata.gsi.go.jp/xyz/pale/10/909/403.png"), base.join(" "));
  for (const s of base) assert.match(s, /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/10\/\d+\/\d+\.png$/);
  assert.equal(H.qa(card, ".labels img").length, 0);
  assert.ok(![...base, ...srcs(card, ".labels img")].some((s) => /arcgis/i.test(s)));
});

test("osm: tile.openstreetmap.org, column before row, no label layer", () => {
  const card = drawn({ zoom: 10, base_map: "osm" });
  const base = srcs(card, ".base img");
  assert.ok(base.includes("https://tile.openstreetmap.org/10/909/403.png"), base.join(" "));
  assert.equal(H.qa(card, ".labels img").length, 0);
});

test("esri (opt-in): the legacy Base tiles (row before column) and a Reference label layer above the radar", () => {
  const card = drawn({ zoom: 10, base_map: "esri" });
  const base = srcs(card, ".base img");
  assert.ok(base.includes(`${BASE_MAPS.esri.url.replace("{z}/{y}/{x}", "10/403/909")}`), base.join(" "));
  const labels = srcs(card, ".labels img");
  assert.equal(labels.length, base.length);
  assert.ok(labels.includes(BASE_MAPS.esri.labelUrl.replace("{z}/{y}/{x}", "10/403/909")), labels.join(" "));
});

test("custom: the configured template is filled, with no label layer", () => {
  const card = drawn({ zoom: 10, base_map: { url: "https://tiles.example.org/a/{z}/{x}/{y}.png?k=1" } });
  assert.ok(srcs(card, ".base img").includes("https://tiles.example.org/a/10/909/403.png?k=1"));
  assert.equal(H.qa(card, ".labels img").length, 0);
});

test("full mode draws the chosen map as well", () => {
  for (const [base_map, re] of [[undefined, /cyberjapandata\.gsi\.go\.jp\/xyz\/pale\//], ["osm", /tile\.openstreetmap\.org\//], ["esri", /server\.arcgisonline\.com\//]]) {
    const card = drawn({ base_map }, false, "full");
    const base = srcs(card, ".base img");
    assert.ok(base.length > 0, String(base_map));
    for (const s of base) assert.match(s, re, String(base_map));
  }
});

test("a custom max_zoom is the highest zoom asked for; above it the tiles are stretched", () => {
  const card = drawn({ zoom: 12, base_map: { url: CUSTOM, max_zoom: 8 } });
  const imgs = H.qa(card, ".base img");
  assert.ok(imgs.length > 0);
  for (const i of imgs) {
    assert.match(i.getAttribute("src"), /^https:\/\/tiles\.example\.org\/8\/\d+\/\d+\.png$/);
    assert.equal(i.style.width, `${256 * 2 ** (12 - 8)}px`);
  }
  // GSI stops at 18, the card never asks above 16: nothing is stretched at the highest zoom setting
  const hi = drawn({ zoom: 16 });
  for (const i of H.qa(hi, ".base img")) {
    assert.match(i.getAttribute("src"), /\/pale\/16\//);
    assert.equal(i.style.width, "256px");
  }
});

test("another base map in setConfig redraws the tiles (the card is rebuilt)", () => {
  const card = drawn({ zoom: 10 });
  assert.ok(srcs(card, ".base img")[0].includes("gsi.go.jp"));
  card.setConfig({ ...E, mode: "compact", zoom: 10, base_map: "osm" });
  H.size(H.q(card, ".radar"), 480, 320);
  card._width = 480; card._height = 320;
  card._renderRadar();
  const now = srcs(card, ".base img");
  assert.ok(now.length > 0);
  assert.ok(now.every((s) => s.startsWith("https://tile.openstreetmap.org/")), now.join(" "));
  assert.match(credit(card), /© OpenStreetMap contributors/);
  assert.doesNotMatch(credit(card), /国土地理院/);
});

test("dark mode: the map filter still applies to GSI, OSM and custom tiles (night class on the base layer)", () => {
  const css = H.text(H.q(drawn({ zoom: 10 }), "style")) || "";
  assert.match(css, /\.base\.night img, \.labels\.night img \{ filter: invert\(1\) hue-rotate\(180deg\)/);
  for (const base_map of [undefined, "gsi", "osm", "esri", { url: CUSTOM }]) {
    const dark = drawn({ zoom: 10, base_map }, true);
    assert.equal(H.q(dark, ".base").classList.contains("night"), true, JSON.stringify(base_map));
    assert.equal(H.q(dark, ".labels").classList.contains("night"), true);
    const light = drawn({ zoom: 10, base_map }, false);
    assert.equal(H.q(light, ".base").classList.contains("night"), false, JSON.stringify(base_map));
  }
});

// ------------------------------------------------------------------ the credit line

test("the credit line shows only the active base map's credit; Esri's appears only for esri", () => {
  const ESRI = /Esri|HERE|Garmin|arcgis/i;
  const gsi = drawn({});
  assert.ok(credit(gsi).includes(GSI_CREDIT), credit(gsi));
  assert.doesNotMatch(credit(gsi), ESRI);
  assert.doesNotMatch(credit(gsi), /OpenStreetMap/);
  const link = H.qa(gsi, ".attr a").find((a) => a.getAttribute("href") === ICHIRAN);
  assert.ok(link, "the GSI credit links to the tile list");
  assert.equal(link.textContent, GSI_CREDIT);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(link.getAttribute("rel"), /noopener/);

  const osm = drawn({ base_map: "osm" });
  assert.ok(credit(osm).includes("© OpenStreetMap contributors"), credit(osm));
  assert.doesNotMatch(credit(osm), ESRI);
  assert.doesNotMatch(credit(osm), /国土地理院/);
  assert.ok(H.qa(osm, ".attr a").some((a) => a.getAttribute("href") === "https://www.openstreetmap.org/copyright"));

  const esri = drawn({ base_map: "esri" });
  assert.ok(credit(esri).includes("Esri, HERE, Garmin, © OpenStreetMap contributors"), credit(esri));
  assert.doesNotMatch(credit(esri), /国土地理院/);

  // the same in the full card, and in each case JMA's own credit stays
  for (const base_map of [undefined, "osm", "esri"]) {
    const full = drawn({ base_map }, false, "full");
    assert.ok(credit(full).includes("出典：気象庁ホームページ"), String(base_map));
    assert.equal(ESRI.test(credit(full)), base_map === "esri", `${base_map}: ${credit(full)}`);
  }
});

test("attributionCredits: the map credit is the given base map's, GSI when none is given", () => {
  assert.equal(attributionCredits({ map: true }).find((c) => c.id === "map").text, GSI_CREDIT);
  assert.equal(attributionCredits({ map: true, baseMap: "osm" }).find((c) => c.id === "map").text, "© OpenStreetMap contributors");
  assert.equal(attributionCredits({ map: true, baseMap: { url: CUSTOM, attribution: "© Example Tiles" } }).find((c) => c.id === "map").text, "© Example Tiles");
  assert.equal(attributionCredits({ baseMap: "osm" }).some((c) => c.id === "map"), false, "no map, no map credit");
  for (const id of BASE_MAP_IDS) for (const c of attributionCredits({ map: true, baseMap: id })) if (c.href) assert.match(c.href, /^https:\/\//);
});

test("a custom base map is credited with the configured text, else with its host only", () => {
  const withText = drawn({ base_map: { url: CUSTOM, attribution: "© Example Tiles, CC BY 4.0" } });
  assert.ok(credit(withText).includes("© Example Tiles, CC BY 4.0"), credit(withText));
  assert.doesNotMatch(credit(withText), /tiles\.example\.org|Esri|国土地理院/);

  const noText = drawn({ base_map: { url: "https://tiles.example.org/v1/{z}/{x}/{y}.png?apikey=SECRET123" } });
  assert.ok(credit(noText).includes("Map tiles: tiles.example.org"), credit(noText));
  assert.doesNotMatch(credit(noText), /SECRET123|apikey|\/v1/);

  // text goes in as text, never as markup
  const markup = drawn({ base_map: { url: CUSTOM, attribution: "<img src=x onerror=alert(1)> © Me" } });
  assert.equal(H.qa(markup, ".attr img").length, 0);
  assert.ok(credit(markup).includes("<img src=x onerror=alert(1)> © Me"));
});

// ------------------------------------------------------------------ validation

test("base_map: a name from the table, or a mapping; anything else says what is allowed", () => {
  assert.equal(normaliseConfig({ ...E, base_map: "" }).base_map, "gsi", "an empty value is not set");
  for (const bad of ["bing", "GSI", 5, true, [], ["gsi"]]) throwsWith({ ...E, base_map: bad }, /`base_map` must be gsi, osm, esri or a mapping/);
  throwsWith({ ...E, base_map: {} }, /`base_map\.url` must be an https tile address/);
  throwsWith({ ...E, base_map: { url: CUSTOM, style: "dark" } }, /unknown key base_map\.style \(allowed: url, attribution, max_zoom\)/);
  throwsWith({ ...E, base_map: { url: CUSTOM, attribution: 5 } }, /`base_map\.attribution` must be text/);
  for (const z of [1, 23, 8.5, "deep", true, 0]) throwsWith({ ...E, base_map: { url: CUSTOM, max_zoom: z } }, /`base_map\.max_zoom` must be a whole number from 2 to 22/);
});

test("base_map.url: https only, and only the placeholders {z} {x} {y}, each present", () => {
  const url = (u) => ({ ...E, base_map: { url: u } });
  throwsWith(url("http://tiles.example.org/{z}/{x}/{y}.png"), /base_map\.url must start with https:\/\//);
  throwsWith(url("//tiles.example.org/{z}/{x}/{y}.png"), /must start with https:\/\//);
  throwsWith(url("/api/tiles/{z}/{x}/{y}.png"), /must start with https:\/\//);
  throwsWith(url("ftp://tiles.example.org/{z}/{x}/{y}.png"), /must start with https:\/\//);
  throwsWith(url("javascript:alert(1)//{z}/{x}/{y}"), /must start with https:\/\//);
  throwsWith(url("data:image/png,{z}{x}{y}"), /must start with https:\/\//);
  throwsWith(url("https://tiles.example.org/{z}/{x}.png"), /needs \{y\} in the address/);
  throwsWith(url("https://tiles.example.org/{x}/{y}.png"), /needs \{z\} in the address/);
  throwsWith(url("https://tiles.example.org/tile.png"), /needs \{z\}, \{x\}, \{y\}/);
  throwsWith(url("https://{s}.tiles.example.org/{z}/{x}/{y}.png"), /unknown placeholder \{s\}/);
  throwsWith(url("https://tiles.example.org/{z}/{x}/{y}.png?t={basetime}"), /unknown placeholder \{basetime\}/);
  throwsWith(url("https://tiles.example.org/{z}/{x}/{y}.png}"), /stray/);
  throwsWith(url("https://tiles.example.org/{z}/{x}/{y} .png"), /spaces/);
  throwsWith(url("https:///{z}/{x}/{y}.png"), /no host name/);
  throwsWith(url("https://user:pass@tiles.example.org/{z}/{x}/{y}.png"), /user name or password/);
  throwsWith({ ...E, base_map: { url: "   " } }, /`base_map\.url` must be an https tile address/);
  throwsWith({ ...E, base_map: { url: 5 } }, /`base_map\.url`/);
});

test("a good custom mapping is checked and normalised; the default zoom limit is 18", () => {
  assert.deepEqual(normaliseConfig({ ...E, base_map: { url: `  ${CUSTOM}  ` } }).base_map, { url: CUSTOM, attribution: "", max_zoom: 18 });
  assert.deepEqual(normaliseConfig({ ...E, base_map: { url: CUSTOM, attribution: "  © Me ", max_zoom: "12" } }).base_map, { url: CUSTOM, attribution: "© Me", max_zoom: 12 });
  assert.equal(normaliseConfig({ ...E, base_map: { url: "https://tiles.example.org/{z}/{y}/{x}.jpg?key=abc&s={z}" } }).base_map.max_zoom, 18);
  const m = resolveBaseMap(normaliseConfig({ ...E, base_map: { url: CUSTOM, max_zoom: 14 } }).base_map);
  assert.equal(m.id, "custom");
  assert.equal(m.maxZoom, 14);
  assert.equal(m.labelUrl, "");
});

test("a bad base_map throws from setConfig and keeps the old configuration", () => {
  const card = document.createElement("ha-jma-card");
  card.setConfig({ ...E, base_map: "osm" });
  assert.throws(() => card.setConfig({ ...E, base_map: "http://tiles.example.org/{z}/{x}/{y}.png" }), /ha-jma-card: `base_map` must be/);
  assert.equal(card._config.base_map, "osm");
});

// ------------------------------------------------------------------ the editor

function editor(config) {
  const ed = document.createElement("ha-jma-card-editor");
  ed.setConfig(config);
  document.body.appendChild(ed);
  return ed;
}
const formOf = (ed) => ed.shadowRoot.querySelector("ha-form");

test("the editor has a select for the base map: GSI, OpenStreetMap, Esri (custom is YAML only)", () => {
  const field = EDITOR_SCHEMA.find((s) => s.name === "base_map");
  assert.ok(field, "base_map is in the schema");
  assert.ok(field.selector.select, "a select");
  assert.deepEqual(field.selector.select.options.map((o) => o.value), BASE_MAP_IDS);
  assert.deepEqual(field.selector.select.options.map((o) => o.value), ["gsi", "osm", "esri"]);
  assert.ok(field.selector.select.options.every((o) => o.label));
  assert.equal(EDITOR_SCHEMA.findIndex((s) => s.name === "base_map") > EDITOR_SCHEMA.findIndex((s) => s.name === "show_radar"), true);
  assert.equal(EDITOR_LABELS.base_map, "Base map");
  const form = formOf(editor(E));
  assert.equal(form.computeLabel(field), "Base map");
  assert.match(form.computeHelper(field), /YAML/);
  assert.equal(form.data.base_map, "gsi", "the control shows the real default");
});

test("choosing a base map in the editor saves it; the default is not written; a YAML mapping is left alone", () => {
  const ed = editor({ type: "custom:ha-jma-card", entity: BASE });
  const seen = [];
  ed.addEventListener("config-changed", (ev) => seen.push(ev.detail.config));
  const send = (value) => formOf(ed).dispatchEvent(new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true }));
  send({ entity: BASE, mode: "compact", square: false, show_radar: true, base_map: "osm" });
  assert.deepEqual(seen.at(-1), { type: "custom:ha-jma-card", entity: BASE, base_map: "osm" });
  assert.doesNotThrow(() => normaliseConfig(seen.at(-1)));
  send({ entity: BASE, base_map: "gsi" });
  assert.deepEqual(seen.at(-1), { type: "custom:ha-jma-card", entity: BASE });

  const custom = { url: CUSTOM, attribution: "© Me", max_zoom: 12 };
  assert.deepEqual(editorData({ entity: BASE, base_map: custom }).base_map, custom);
  assert.deepEqual(cleanEditorConfig({ entity: BASE, base_map: custom }, { entity: BASE, title: "Home", base_map: custom }), { entity: BASE, title: "Home", base_map: custom });
  assert.equal(cleanEditorConfig({ entity: BASE }, { entity: BASE, base_map: "esri" }).base_map, "esri");
});

// ------------------------------------------------------------------ the documents

test("the README and README.ja document base_map and quote each provider's terms; the CHANGELOG lists it", () => {
  for (const f of ["README.md", "README.ja.md"]) {
    const doc = read(f);
    assert.match(doc, /`base_map`/, f);
    for (const id of BASE_MAP_IDS) assert.ok(doc.includes(BASE_MAPS[id].terms), `${f}: terms of ${id}: ${BASE_MAPS[id].terms}`);
    assert.ok(doc.includes("https://www.openstreetmap.org/copyright"), f);
    assert.ok(doc.includes(ICHIRAN), f);
    assert.ok(doc.includes("max_zoom"), f);
    assert.doesNotMatch(doc, /JMA, Esri and (the )?GSI|気象庁・Esri・国土地理院/, `${f}: Esri is no longer a server every install contacts`);
  }
  const log = read("CHANGELOG.md");
  assert.match(log, /`base_map`/);
  assert.match(log, /GSI/);
  assert.match(log, /card picker/i);
  assert.doesNotMatch(log, /base map is Esri World Light Gray/);
});
