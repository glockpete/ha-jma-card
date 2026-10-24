"use strict";
// Light and dark: hass.themes.darkMode picks the palette; the token chain; the literals keep their contrast.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./harness.cjs");
const F = require("./fixtures.cjs");

const { BASE_TOKENS, DERIVED_TOKENS, tokenDecls } = H.helpers;
const BASE = "weather.jma_chiyoda";
test.afterEach(() => H.cleanup());

const css = (card) => H.q(card, "style").textContent;
const hass = (dark) => F.makeHass({ themes: { darkMode: dark } });

// WCAG relative luminance and contrast of two #rrggbb colours
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const mix = (a, b, pctB) => a.map((v, i) => v * (1 - pctB / 100) + b[i] * (pctB / 100));
const literal = (name, dark) => { const t = BASE_TOKENS.find((x) => x[0] === name); return rgb(dark ? t[4] : t[3]); };

test("the card follows hass.themes.darkMode, in both directions, without a rebuild", () => {
  const card = H.mount({ entity: BASE }, hass(false));
  const shell = H.q(card, "ha-card");
  assert.equal(shell.classList.contains("dark"), false);
  card.hass = hass(true);
  assert.equal(H.q(card, "ha-card"), shell, "same element: only the class changed");
  assert.equal(shell.classList.contains("dark"), true);
  card.hass = hass(false);
  assert.equal(shell.classList.contains("dark"), false);
});

test("a card built while the theme is dark starts dark; a hass with no themes is light", () => {
  assert.equal(H.q(H.mount({ entity: BASE }, hass(true)), "ha-card").classList.contains("dark"), true);
  const noThemes = F.makeHass();
  delete noThemes.themes;
  assert.equal(H.q(H.mount({ entity: BASE }, noThemes), "ha-card").classList.contains("dark"), false);
});

test("the full card takes the same palette switch", () => {
  const card = H.mount({ entity: BASE, mode: "full" }, hass(true));
  assert.equal(H.q(card, "ha-card").classList.contains("dark"), true);
  card.hass = hass(false);
  assert.equal(H.q(card, "ha-card").classList.contains("dark"), false);
});

test("the stylesheet has a light palette on :host and a dark palette on ha-card.dark", () => {
  const sheet = css(H.mount({ entity: BASE }, hass(false)));
  const host = /:host \{([\s\S]*?)\n        \}/.exec(sheet)[1];
  const dark = /ha-card\.dark \{([\s\S]*?)\n        \}/.exec(sheet)[1];
  assert.ok(host.includes(tokenDecls(false)), "light declarations on :host");
  assert.ok(dark.includes(tokenDecls(true)), "dark declarations on ha-card.dark");
  assert.notEqual(tokenDecls(false), tokenDecls(true));
  assert.match(literal("ground", false).join(), /255,255,255/);
  assert.notDeepEqual(literal("ground", true), literal("ground", false));
});

test("every token has the chain: --jma-card-*, then Material 3, then Home Assistant, then the literal", () => {
  for (const mode of [false, true]) {
    const decls = tokenDecls(mode);
    for (const [name, m3, ha, light, dark] of BASE_TOKENS) {
      const want = `--jc-${name}: var(--jma-card-${name}, ${m3 ? `var(--md-sys-color-${m3}, ` : ""}${ha.map((v) => `var(${v}, `).join("")}${mode ? dark : light}${")".repeat(ha.length + (m3 ? 1 : 0))});`;
      assert.ok(decls.includes(want), want);
    }
    for (const [name, m3] of DERIVED_TOKENS) {
      assert.ok(decls.includes(`--jc-${name}: var(--jma-card-${name}, ${m3 ? `var(--md-sys-color-${m3}, ` : ""}`), name);
    }
  }
  const ink = tokenDecls(false).split("\n").find((l) => l.includes("--jc-ink:"));
  assert.match(ink, /var\(--jma-card-ink, var\(--md-sys-color-on-surface, var\(--primary-text-color, #1d1b20\)\)\)/);
});

test("every --jc-* token the stylesheet reads is declared, and none refers to itself", () => {
  const sheet = css(H.mount({ entity: BASE }, hass(false)));
  const declared = new Set([...sheet.matchAll(/(--jc-[a-z0-9-]+):/g)].map((m) => m[1]));
  const used = new Set([...sheet.matchAll(/var\((--jc-[a-z0-9-]+)/g)].map((m) => m[1]));
  const set_by_script = new Set(["--jc-stick-top"]);   // written by the card with the header height
  const missing = [...used].filter((n) => !declared.has(n) && !set_by_script.has(n));
  assert.deepEqual(missing, []);
  for (const m of sheet.matchAll(/(--jc-[a-z0-9-]+):\s*var\((--jc-[a-z0-9-]+)\)/g)) assert.notEqual(m[1], m[2], m[0]);
});

test("public names are --jma-card-*; no earlier prefix is left", () => {
  const sheet = css(H.mount({ entity: BASE }, hass(false)));
  assert.match(sheet, /--jma-card-ink/);
  assert.match(sheet, /--jma-card-radius/);
  assert.match(sheet, /--jma-card-spring-fast/);
  assert.match(sheet, /--jma-card-effects/);
  assert.doesNotMatch(sheet, /--nk-|--nw-/);
});

test("the radius, spring and effects tokens have defaults the card draws with", () => {
  const sheet = css(H.mount({ entity: BASE }, hass(false)));
  assert.match(sheet, /--jc-radius: var\(--jma-card-radius, 32px\)/);
  assert.match(sheet, /border-radius: var\(--jc-radius\)/);
});

for (const [label, dark] of [["light", false], ["dark", true]]) {
  test(`${label} literals: text keeps its contrast on the card and on every tonal layer`, () => {
    const ground = literal("ground", dark);
    const ink = literal("ink", dark);
    const muted = literal("muted", dark);
    assert.ok(contrast(ink, ground) >= 7, `ink ${contrast(ink, ground).toFixed(1)}`);
    assert.ok(contrast(muted, ground) >= 4.5, `muted ${contrast(muted, ground).toFixed(1)}`);
    assert.ok(contrast(literal("rain", dark), ground) >= 4.5, `rain ${contrast(literal("rain", dark), ground).toFixed(1)}`);
    assert.ok(contrast(literal("on-primary", dark), literal("primary", dark)) >= 4.5, "on-primary on primary");
    // the layers are mixed from ground and ink exactly as the stylesheet says (panel 8 %, well 12 %, tile 5 %, containers 22-24 %)
    const layers = {
      panel: mix(ground, ink, 8), well: mix(ground, ink, 12), tile: mix(ground, ink, 5),
      primaryContainer: mix(ground, literal("primary", dark), 24), secondaryContainer: mix(ground, literal("secondary", dark), 22),
      errorContainer: mix(ground, literal("error", dark), 22), coralContainer: mix(ground, literal("accent", dark), 24),
    };
    for (const [name, bg] of Object.entries(layers)) {
      assert.ok(contrast(ink, bg) >= 7, `ink on ${name} ${contrast(ink, bg).toFixed(1)}`);
    }
    for (const name of ["panel", "well", "tile"]) assert.ok(contrast(muted, layers[name]) >= 4.5, `muted on ${name} ${contrast(muted, layers[name]).toFixed(1)}`);
  });
}

test("the dark map filter follows the same switch (night classes on the map layers)", () => {
  const card = H.mount({ entity: BASE, mode: "full" }, hass(false));
  const radar = H.q(card, ".radar");
  H.size(radar, 480, 320);   // jsdom does no layout
  for (const [dark, expect] of [[true, true], [false, false]]) {
    card._width = 480; card._height = 320;
    card.hass = hass(dark);
    card._radarKey = "";
    card._renderRadar();
    assert.equal(H.q(card, ".base").classList.contains("night"), expect, `dark=${dark}`);
  }
});
