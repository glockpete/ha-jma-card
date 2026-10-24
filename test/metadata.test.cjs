"use strict";
// The version in the card, the package and the HACS metadata agree; the file HACS serves is the one in the repository root.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CARD_VERSION, CARD_TAG } = require("./harness.cjs").helpers;

const root = path.join(__dirname, "..");
const read = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : null);
const card = read("ha-jma-card.js");

test("CARD_VERSION is a semantic version and the console banner prints it", () => {
  assert.match(CARD_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(card, new RegExp(`const CARD_VERSION = "${CARD_VERSION.replace(/\./g, "\\.")}";`));
  assert.match(card, /console\.info\(`%c HA-JMA-CARD %c \$\{CARD_VERSION\} `/);
  assert.equal(CARD_TAG, "ha-jma-card");
});

test("the repository root holds ha-jma-card.js (HACS: a plugin's file is named after the repository)", () => {
  assert.ok(card && card.length > 1000);
});

test("package.json carries the same version", (t) => {
  const raw = read("package.json");
  if (raw === null) return t.skip("package.json is not in this tree yet");
  assert.equal(JSON.parse(raw).version, CARD_VERSION);
});

test("hacs.json names the file HACS should serve", (t) => {
  const raw = read("hacs.json");
  if (raw === null) return t.skip("hacs.json is not in this tree yet");
  const hacs = JSON.parse(raw);
  assert.ok(hacs.name);
  assert.ok(!hacs.filename || hacs.filename === "ha-jma-card.js", "filename, when given, is the card file");
  assert.ok(!hacs.zip_release, "zip_release is for integrations only");
});

test("the changelog's newest entry is the card's version", (t) => {
  const raw = read("CHANGELOG.md");
  if (raw === null) return t.skip("CHANGELOG.md is not in this tree yet");
  const first = /^## \[(\d+\.\d+\.\d+)\]/m.exec(raw);
  assert.ok(first, "a Keep a Changelog heading");
  assert.equal(first[1], CARD_VERSION);
});

test("the release workflow uploads the card file and checks the tag against the version", (t) => {
  const raw = read(".github/workflows/release.yml");
  if (raw === null) return t.skip("release.yml is not in this tree yet");
  assert.match(raw, /ha-jma-card\.js/);
  assert.match(raw, /CARD_VERSION/);
});
