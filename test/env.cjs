"use strict";
// The browser the tests run in. jsdom (https://github.com/jsdom/jsdom, a devDependency) supplies the DOM: elements, custom
// elements, shadow DOM, the HTML parser, selectors, events, localStorage and history. This file adds only what jsdom does not
// have or what is specific to this card: ResizeObserver, matchMedia, a canvas 2D context, a fetch that never leaves the
// process, and timers that never keep the test process alive.
//
// The card is loaded with require(), so it runs in Node's realm with jsdom's window installed as the global DOM (the way
// jsdom-global and mocha setups do it). Loading it with window.eval() instead would make every object it returns come from
// another realm and fail assert.deepStrictEqual on prototypes. jsdom has no layout: clientWidth and friends are 0 until a
// test sets them with size() in harness.cjs.
const { JSDOM } = require("jsdom");

// jsdom needs a non-opaque origin before it will hand out localStorage and let history.pushState change the path.
const ORIGIN = "http://localhost/";

// what the card and the tests read as bare globals; each is jsdom's own object, not a copy
const DOM_GLOBALS = ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent", "Node", "Element", "ShadowRoot",
  "localStorage", "history", "location"];

/** Starts a jsdom window, puts the DOM globals the card reads on globalThis and returns the env a test inspects. */
function install() {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: ORIGIN, pretendToBeVisual: true });
  const { window } = dom;
  const env = { dom, window, fetches: [], observers: [], reducedMotion: false };

  // -- stubs for what jsdom lacks
  window.matchMedia = (query) => ({
    matches: /reduce/.test(query) ? env.reducedMotion : false, media: query, addEventListener() {}, removeEventListener() {},
  });
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = []; env.observers.push(this); }
    observe(target) { this.targets.push(target); }
    unobserve() {}
    disconnect() { this.targets = []; }
  }
  window.ResizeObserver = ResizeObserver;
  // no network from a test: Node's own fetch would reach out
  window.fetch = (url) => { env.fetches.push(String(url)); return Promise.reject(new Error("tests: no network")); };
  // a canvas 2D context that accepts every call (jsdom has none without the native canvas package)
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    const canvas = this;
    const sink = new Proxy(function () {}, { get: (t, k) => (k === "canvas" ? canvas : sink), set: () => true, apply: () => sink });
    return sink;
  };

  // -- globals: defineProperty, not assignment, because some of these (Event, localStorage) are accessors on a recent Node
  const globals = Object.fromEntries(DOM_GLOBALS.map((k) => [k, window[k]]));
  Object.assign(globals, { ResizeObserver, fetch: window.fetch });
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });

  // timers must never keep the test process alive
  for (const name of ["setInterval", "setTimeout"]) {
    const real = globalThis[name];
    globalThis[name] = (...a) => { const h = real(...a); if (h && h.unref) h.unref(); return h; };
  }
  return env;
}

module.exports = { install, ORIGIN };
