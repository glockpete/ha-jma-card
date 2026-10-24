"use strict";
// The screenshot harness (test/harness/harness.js) mounts the card with made-up Chiyoda data in both modes and both themes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./harness.cjs");

const code = fs.readFileSync(path.join(__dirname, "harness", "harness.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "harness", "index.html"), "utf8");

function run(search) {
  H.cleanup();
  const body = document.body;
  body.replaceChildren();
  body.className = "";
  body.innerHTML = '<div id="host"></div>';
  history.replaceState(null, "", `/${search}`);   // harness.js reads location.search
  vm.runInThisContext(code);
  return document.getElementById("host").querySelector("ha-jma-card");
}
test.afterEach(() => { const c = document.querySelector("ha-jma-card"); if (c) c.remove(); });

test("the page loads the card file and the harness script", () => {
  assert.match(html, /<script src="\.\.\/\.\.\/ha-jma-card\.js"><\/script>/);
  assert.match(html, /<script src="harness\.js"><\/script>/);
  assert.match(html, /body\.dark \{/);
  assert.match(html, /body\.light \{/);
});

for (const [mode, theme] of [["compact", "light"], ["compact", "dark"], ["full", "light"], ["full", "dark"]]) {
  test(`${mode} / ${theme}: the card renders the synthetic data in the right theme`, () => {
    const card = run(`?mode=${mode}&theme=${theme}&base=20261024162000`);
    assert.ok(card, "card mounted");
    const shell = card.shadowRoot.querySelector("ha-card");
    assert.equal(shell.classList.contains("full"), mode === "full");
    assert.equal(shell.classList.contains("dark"), theme === "dark");
    assert.equal(document.body.className, theme);
    assert.match(card.shadowRoot.querySelector(".temp").textContent, /^21/);
    assert.match(card.shadowRoot.querySelector(".attr").textContent, /出典：気象庁ホームページ/);
    assert.equal(card._config.entity, "weather.jma_chiyoda");
    assert.equal(card._hass.config.latitude, 35.6812);
    assert.equal(card._hass.config.longitude, 139.7671);
  });
}

test("the radar frames follow the base given in the address", () => {
  const card = run("?mode=compact&theme=light&base=20261024162000");
  const a = card._hass.states["sensor.jma_chiyoda_radar_frames"].attributes;
  assert.equal(a.basetime, "20261024162000");
  assert.equal(a.past.at(-1), "20261024162000");
  assert.equal(a.past.length, 7);
  assert.equal(a.forecast[0], "20261024162500");
  assert.equal(a.forecast.length, 12);
  assert.match(a.tile_template, /^https:\/\/www\.jma\.go\.jp\/bosai\/jmatile\//);
});

test("no base in the address: frames are built from the clock and nothing throws", () => {
  const card = run("?mode=compact");
  assert.match(card._hass.states["sensor.jma_chiyoda_radar_frames"].attributes.basetime, /^\d{14}$/);
});

test("the made-up data names only the example place", () => {
  assert.doesNotMatch(code, /192\.168|@|https?:\/\/(?!www\.jma\.go\.jp)/);
  assert.match(code, /35\.6812/);
  assert.match(code, /139\.7671/);
});
