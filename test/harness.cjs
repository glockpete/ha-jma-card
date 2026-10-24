"use strict";
// Loads the card once per test process under jsdom (see env.cjs) and gives the tests a way to mount it.
const path = require("node:path");
const envModule = require("./env.cjs");

const env = envModule.install();
const helpers = require(path.join(__dirname, "..", "ha-jma-card.js"));
const Card = customElements.get("ha-jma-card");
const Editor = customElements.get("ha-jma-card-editor");

const mounted = [];

/** A card in the document: setConfig, then attached, then hass (the order Home Assistant uses). Returns the element. */
function mount(config, hass) {
  const card = document.createElement("ha-jma-card");
  card.setConfig(config);
  document.body.appendChild(card);
  if (hass) card.hass = hass;
  mounted.push(card);
  return card;
}

/** Detaches every card mounted so far (clears the 60 s tick and the subscriptions), empties the storage, resets the path. */
function cleanup() {
  while (mounted.length) { const c = mounted.pop(); if (c.parentNode) c.remove(); }
  localStorage.clear();
  history.replaceState(null, "", "/");
}

/** jsdom does no layout, so the sizes a browser would measure are 0: give an element the ones a test needs. */
function size(el, width, height) {
  Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
}

const q = (card, sel) => card.shadowRoot.querySelector(sel);
const qa = (card, sel) => [...card.shadowRoot.querySelectorAll(sel)];   // an Array: the tests map and filter the result
const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : null);

module.exports = { env, helpers, Card, Editor, mount, cleanup, size, q, qa, text };
