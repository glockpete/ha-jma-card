# Contributing

Thanks for helping. Bug reports and pull requests are welcome.

## Reporting a problem

Open an issue and fill in the form. Include the card's YAML, the card version and what the browser console says.
Please do not post coordinates: remove a `home:` line from the YAML first, and crop a radar screenshot if you do not
want to show your area.

A wrong or missing value (a forecast, a warning, a sensor) comes from the
[ha-jma integration](https://github.com/glockpete/ha-jma); report that there.

## Running the tests

The card is one file, `ha-jma-card.js`, with no build step and nothing to install to use it. The tests use Node's own
test runner (Node 22 or newer) and [jsdom](https://github.com/jsdom/jsdom) as the DOM, so they need no browser and no
network. jsdom is the only dependency and it is a devDependency: it is never shipped.

```bash
npm ci && npm test
```

`npm test` runs `node --test "test/*.test.cjs"`; the glob is quoted so that Node expands it and the same command works on
Windows, macOS and Linux. The other files in `test/` (`env.cjs`, `fixtures.cjs`, `harness.cjs`) are helpers, not tests.
`env.cjs` starts jsdom and adds only what jsdom lacks: `ResizeObserver`, `matchMedia`, a canvas 2D context and a `fetch`
that never leaves the process. jsdom 30 asks for Node 22.22.2 or newer; an older 22.x makes npm print a warning.

`.github/workflows/tests.yml` runs `npm ci` and `npm test` in CI.

## Pull requests

- Keep a change small and say what it fixes in the description.
- Add or change a test.
- Home Assistant data (a state, an attribute) goes into the page through `textContent`, `src` or `title`, never
  through `innerHTML`. The comment at the top of `ha-jma-card.js` states the rule.
- Keep the credits correct: a new data source adds its entry to `CREDITS` in `ha-jma-card.js` and to the attribution
  list in the README. JMA's credit stays on the card in every mode.
- A new configuration key is added to `normaliseConfig`, to the visual editor schema, and to the configuration
  table in `README.md` and `README.ja.md`.
- Update `CHANGELOG.md`.
- A release changes the version in three places: `CARD_VERSION` in `ha-jma-card.js`, `version` in `package.json`
  and the heading in `CHANGELOG.md`. The release workflow refuses a tag that does not match `CARD_VERSION`.
