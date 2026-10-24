"use strict";
// The visual editor: renders a <ha-form> over the schema and reports every change as `config-changed`.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { EDITOR_SCHEMA, EDITOR_LABELS, EDITOR_KEYS, ENTITY_ROLES, editorData, cleanEditorConfig, normaliseConfig } = H.helpers;
test.afterEach(() => H.cleanup());

function editor(config, hass) {
  const ed = document.createElement("ha-jma-card-editor");
  if (hass) ed.hass = hass;
  ed.setConfig(config);
  document.body.appendChild(ed);
  return ed;
}
const formOf = (ed) => ed.shadowRoot.querySelector("ha-form");
const change = (ed, value) => {
  const seen = [];
  ed.addEventListener("config-changed", (ev) => seen.push(ev));
  formOf(ed).dispatchEvent(new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true }));
  return seen;
};

test("the editor renders one ha-form with the schema, the data and hass", () => {
  const hass = F.makeHass();
  const ed = editor({ type: "custom:ha-jma-card", entity: "weather.jma_chiyoda" }, hass);
  const form = formOf(ed);
  assert.ok(form, "ha-form present");
  assert.equal(form.schema, EDITOR_SCHEMA);
  assert.equal(form.hass, hass);
  assert.equal(form.data.entity, "weather.jma_chiyoda");
  assert.equal(form.data.mode, "compact");
  assert.equal(form.data.show_radar, true);
  assert.equal(form.data.square, false);
  assert.deepEqual(form.data.entities, {});
  assert.equal(ed.shadowRoot.querySelectorAll("ha-form").length, 1);
});

test("a later setConfig and a later hass update the same form", () => {
  const ed = editor({ entity: "weather.jma_chiyoda" });
  const form = formOf(ed);
  assert.equal(form.hass, null);
  const hass = F.makeHass();
  ed.hass = hass;
  assert.equal(form.hass, hass);
  ed.setConfig({ entity: "weather.jma_osaka", mode: "full", title: "Osaka" });
  assert.equal(formOf(ed), form, "the form is kept");
  assert.equal(form.data.entity, "weather.jma_osaka");
  assert.equal(form.data.mode, "full");
  assert.equal(form.data.title, "Osaka");
});

test("the schema: a JMA weather entity picker first, then the options, then two expandable groups", () => {
  assert.deepEqual(EDITOR_SCHEMA[0], { name: "entity", required: true, selector: { entity: { domain: "weather", integration: "jma" } } });
  const names = EDITOR_SCHEMA.map((s) => s.name);
  assert.deepEqual(names, ["entity", "title", "icon", "mode", "square", "show_radar", "base_map", "navigate", "alert_entity", "entities", "lightning"]);
  const groups = EDITOR_SCHEMA.filter((s) => s.type === "expandable");
  assert.deepEqual(groups.map((g) => g.name), ["entities", "lightning"]);
  assert.deepEqual(groups[0].schema.map((s) => s.name), ENTITY_ROLES);
  assert.deepEqual(groups[1].schema.map((s) => s.name), ["distance", "azimuth", "counter", "source", "minutes"]);
  const sun = groups[0].schema.find((s) => s.name === "sun");
  assert.deepEqual(sun.selector, { entity: { domain: "sun" } });
  assert.deepEqual(groups[0].schema.find((s) => s.name === "wbgt").selector, { entity: { integration: "jma" } });
  assert.deepEqual(EDITOR_KEYS, names);
});

test("every control has a label, and the form asks for it through computeLabel", () => {
  const ed = editor({ entity: "weather.jma_chiyoda" });
  const form = formOf(ed);
  const all = [...EDITOR_SCHEMA, ...EDITOR_SCHEMA.filter((s) => s.schema).flatMap((s) => s.schema)];
  for (const s of all) {
    assert.ok(EDITOR_LABELS[s.name], `label for ${s.name}`);
    assert.equal(form.computeLabel(s), EDITOR_LABELS[s.name]);
  }
  assert.equal(form.computeLabel({ name: "unlisted" }), "unlisted");
  assert.match(form.computeHelper({ name: "entity" }), /JMA/);
  assert.equal(form.computeHelper({ name: "title" }), "");
});

test("a change in the form fires config-changed with the cleaned config (bubbles, composed)", () => {
  const ed = editor({ type: "custom:ha-jma-card", entity: "weather.jma_chiyoda" }, F.makeHass());
  const seen = change(ed, { entity: "weather.jma_osaka", title: "Osaka", icon: "", mode: "compact", square: false, show_radar: true, navigate: "", alert_entity: "", entities: { wbgt: "sensor.my_wbgt", warnings: "" }, lightning: {} });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "config-changed");
  assert.equal(seen[0].bubbles, true);
  assert.equal(seen[0].composed, true);
  assert.deepEqual(seen[0].detail.config, { type: "custom:ha-jma-card", entity: "weather.jma_osaka", title: "Osaka", entities: { wbgt: "sensor.my_wbgt" } });
  assert.doesNotThrow(() => normaliseConfig(seen[0].detail.config));
});

test("the form's own value-changed does not leak past the editor", () => {
  const ed = editor({ entity: "weather.jma_chiyoda" });
  const outside = [];
  document.body.addEventListener("value-changed", (ev) => outside.push(ev));
  change(ed, { entity: "weather.jma_osaka" });
  assert.equal(outside.length, 0);
});

test("a cleared control drops its key; keys the form does not manage are kept", () => {
  const start = { type: "custom:ha-jma-card", entity: "weather.jma_chiyoda", title: "Home", alert_entity: "sensor.my_alert", home: [35.6812, 139.7671],
    spans: [10, 50], grid_options: { rows: 4 }, lightning: { counter: "sensor.strikes_counter", minutes: 20 } };
  const ed = editor(start);
  const seen = change(ed, { entity: "weather.jma_chiyoda", mode: "compact", square: false, show_radar: true, lightning: { counter: "sensor.strikes_counter", minutes: 20 } });
  const cfg = seen[0].detail.config;
  assert.equal(cfg.title, undefined, "title cleared");
  assert.equal(cfg.alert_entity, undefined, "alert entity cleared");
  assert.deepEqual(cfg.home, [35.6812, 139.7671]);
  assert.deepEqual(cfg.spans, [10, 50]);
  assert.deepEqual(cfg.grid_options, { rows: 4 });
  assert.deepEqual(cfg.lightning, { counter: "sensor.strikes_counter", minutes: 20 });
  assert.doesNotThrow(() => normaliseConfig(cfg));
});

test("non-default choices are kept, defaults are not written", () => {
  assert.deepEqual(cleanEditorConfig({ entity: "weather.a_b" }, { entity: "weather.a_b", mode: "full", square: true, show_radar: false, navigate: "/lovelace/weather" }),
    { entity: "weather.a_b", mode: "full", square: true, show_radar: false, navigate: "/lovelace/weather" });
  assert.deepEqual(cleanEditorConfig({}, { entity: "weather.a_b", mode: "compact", square: false, show_radar: true }), { entity: "weather.a_b" });
  assert.deepEqual(cleanEditorConfig({ entity: "weather.a_b" }, null), {});
});

test("editorData fills what the form must show and leaves the config alone", () => {
  const cfg = { entity: "weather.a_b", lightning: { counter: "sensor.c_d" } };
  const data = editorData(cfg);
  assert.deepEqual(data, { entity: "weather.a_b", mode: "compact", square: false, show_radar: true, base_map: "gsi", entities: {}, lightning: { counter: "sensor.c_d" } });
  assert.deepEqual(cfg, { entity: "weather.a_b", lightning: { counter: "sensor.c_d" } });
  assert.deepEqual(editorData(undefined).entities, {});
});

test("ignored: a value-changed with no value does nothing", () => {
  const ed = editor({ entity: "weather.jma_chiyoda" });
  const seen = [];
  ed.addEventListener("config-changed", (ev) => seen.push(ev));
  formOf(ed).dispatchEvent(new CustomEvent("value-changed", { detail: {}, bubbles: true }));
  formOf(ed).dispatchEvent(new CustomEvent("value-changed", { bubbles: true }));
  assert.equal(seen.length, 0);
});
