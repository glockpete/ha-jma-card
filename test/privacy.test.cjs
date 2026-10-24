"use strict";
// The shipped card must carry no private network detail, contact detail or real coordinates.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const FORBIDDEN = [
  ["a private address", /\b192\.168\.\d+\.\d+\b|\b10\.\d+\.\d+\.\d+\b|\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\b/],
  ["a private host", /\.local\b|localhost:\d/i],
  ["a phone number", /\b0\d{1,3}-\d{3,4}-\d{4}\b/],
  ["an address", /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
];

const card = fs.readFileSync(path.join(root, "ha-jma-card.js"), "utf8");

for (const [what, re] of FORBIDDEN) {
  test(`ha-jma-card.js has no ${what}`, () => {
    const hit = re.exec(card);
    assert.equal(hit, null, hit ? `"${hit[0]}" at offset ${hit.index}: ${card.slice(Math.max(0, hit.index - 40), hit.index + 60).replace(/\n/g, " ")}` : "");
  });
}

test("the only coordinates in the card are the example home (Tokyo Station) or none", () => {
  const coords = card.match(/\b(3[0-9]|4[0-5])\.\d{3,}\b/g) || [];
  for (const c of coords) assert.ok(c.startsWith("35.68"), c);
});

test("the card carries no token-like secret", () => {
  assert.doesNotMatch(card, /eyJ[A-Za-z0-9_-]{20,}\./);
  assert.doesNotMatch(card, /\b(ghp|gho|sk|xox[bp])[-_][A-Za-z0-9]{16,}/);
});

test("the test fixtures use the example home only", () => {
  for (const f of ["fixtures.cjs", "harness.cjs", "env.cjs"]) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    for (const [what, re] of FORBIDDEN) assert.equal(re.exec(src), null, `${f}: ${what}`);
  }
  const fx = fs.readFileSync(path.join(__dirname, "fixtures.cjs"), "utf8");
  assert.match(fx, /lat: 35\.6812, lon: 139\.7671/);
  assert.match(fx, /1310100/);
});

test("the documents and workflows in this tree are clean too", () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      // node_modules and package-lock.json are other people's code and registry data, not ours to scan
      if (e.name === "node_modules" || e.name === ".git" || e.name === "test" || e.name === "package-lock.json") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|json|ya?ml|js|html|txt)$/i.test(e.name)) files.push(p);
    }
  };
  walk(root);
  assert.ok(files.length >= 1);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const [what, re] of FORBIDDEN) {
      if (what === "an address" && /(LICENSE|SECURITY|CONTRIBUTING|README|CHANGELOG)/i.test(path.basename(f))) continue;   // a contact address may be given there
      const hit = re.exec(src);
      assert.equal(hit, null, `${path.relative(root, f)}: ${what}: "${hit && hit[0]}"`);
    }
  }
});
