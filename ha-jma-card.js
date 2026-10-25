/**
 * ha-jma-card - a Home Assistant dashboard card for the ha-jma integration (JMA Weather, Unofficial).
 * https://github.com/glockpete/ha-jma-card    MIT licence    Unofficial: not made, endorsed or supported by JMA.
 *
 * compact: header (now) - warning chips and notice lines (only when any) - NEXT-HOUR rain chart - radar thumbnail -
 *          a drop-down under the radar holding hourly, rain chances, 7-day range bars, details and the overview.
 *          `square: true` keeps the CLOSED card 1:1; opening the drop-down lets it grow downward.
 * full:    the same modules with every section open and a radar loop (play, scrub, zoom, map layers). From 880 px
 *          wide (a panel view) the radar sits on the left, sticky, with the forecast column on the right.
 *
 * Configuration: `entity` is the only required key (a ha-jma weather entity). The other ha-jma entities of the same
 * device are found through the entity registry (`hass.entities`: same device_id, platform "jma", translation_key);
 * `entities:` names any of them by hand and wins. Blitzortung lightning (`lightning:`) and an alert entity
 * (`alert_entity:`) are optional and off until configured. Every optional entity only hides its own part.
 *
 * Languages: the card is bilingual by design. JMA's own terms stay in Japanese (warning names, 震度, キキクル,
 * 天気概況, weekday in the 7-day list) with an English label next to them; the dates, times and numbers follow the
 * Home Assistant language (`hass.locale.language`) and time zone (`hass.config.time_zone`). Temperatures follow the
 * weather entity's `temperature_unit`; the WBGT figure is always in degrees Celsius.
 *
 * Attribution: JMA's credit line is always on the card (JMA terms: 出典：気象庁ホームページ, and a statement that
 * the data was edited). Open-Meteo, 環境省, P2P地震情報 and Blitzortung.org are added only while data from them is shown,
 * and the map credit of the base map in use (only that one) while a map is drawn.
 *
 * Data comes only from Home Assistant entities; map tiles load as <img> straight from JMA, the base map's server
 * (`base_map`: GSI by default, or OpenStreetMap, Esri or a custom https tile URL) and the GSI hazard map (the frame
 * lists come from the radar_frames sensor, because JMA's targetTimes JSON has no CORS header).
 * Security: no innerHTML interpolation of Home Assistant data. The shell built once in _build() is a static
 * string; every value from a state or attribute goes in through textContent / src / title.
 */

const CARD_VERSION = "0.13.2";
const CARD_TAG = "ha-jma-card";
// The last-resort time zone, used only when Home Assistant gives none. JMA's own calendar (the nationwide day, the
// 17:00 issue) is Japan's, so that logic uses JST whatever zone the display uses.
const FALLBACK_TZ = "Asia/Tokyo";
const JST = "Asia/Tokyo";
const NBSP = String.fromCharCode(160);   // no-break space: keeps a figure and its unit, or a place name, on one line
const JMA_ICON = "https://www.jma.go.jp/bosai/forecast/img/";
const JMA_URL_RE = /^https:\/\/www\.jma\.go\.jp\//;
const RADAR_MAX_Z = 10; // JMA serves hrpns tiles up to z10
// ---- base maps: one row per `base_map` choice (the table pattern of weather-radar-card's `map_style`: tile url, credit, max zoom).
// url: a template; fillTemplate() replaces {z} {x} {y} by name, so Esri's order {z}/{y}/{x} (row before column) needs nothing special.
// labelUrl: a transparent label layer drawn above the radar; "" when the labels are in the base picture (GSI, OSM).
// maxZoom: the highest zoom the server has tiles for; above it the tiles of that zoom are stretched (gridTiles).
// credit: the line shown on the card while a map is drawn (CREDITS has the other data sources). terms: where the provider's
// terms are (also in the README). Only the credit of the ACTIVE base map is ever shown.
const VMAP0_NOTICE = "Shoreline data is derived from: United States. National Imagery and Mapping Agency. \"Vector Map Level 0 (VMAP0).\" Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.";
const BASE_MAPS = {
  // GSI 淡色地図 (pale): no key, no application for tiles loaded live in an app, credit + link required. Zoom 2-8 world,
  // 5-18 Japan and its surroundings; z19 answers 404 (checked 2026-10-25).
  gsi: {
    url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", labelUrl: "", maxZoom: 18,
    credit: { text: "出典：国土地理院（地理院タイル）", href: "https://maps.gsi.go.jp/development/ichiran.html",
      title: `Base map: GSI pale (淡色地図), 地理院タイル. ${VMAP0_NOTICE}` },
    terms: "https://maps.gsi.go.jp/development/ichiran.html",
  },
  // OpenStreetMap standard tiles: free, best effort, no SLA; the credit must be clear on the map (tile usage policy).
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", labelUrl: "", maxZoom: 19,
    credit: { text: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright",
      title: "Base map: OpenStreetMap standard tiles; map data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)" },
    terms: "https://operations.osmfoundation.org/policies/tiles/",
  },
  // Esri legacy World Light Gray (Base + Reference): kept as an opt-in. Esri's terms want Esri software or an ArcGIS Online
  // subscription, and the item is in mature support. It answers 200 with a "Map data not yet available" tile from z17
  // over a city (checked 2026-09-30), so it stops at z16. The labels (Japanese with English underneath) go above the radar.
  esri: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
    credit: { text: "Esri, HERE, Garmin, © OpenStreetMap contributors",
      title: "Base map: Esri World Light Gray; map data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)" },
    terms: "https://goto.arcgis.com/termsofuse/viewsummary",
  },
};
const BASE_MAP_IDS = Object.keys(BASE_MAPS);
const DEFAULT_BASE_MAP = "gsi";
const CUSTOM_BASE_KEYS = ["url", "attribution", "max_zoom"];
const CUSTOM_MAX_ZOOM = 18;     // `base_map.max_zoom` when a custom base map gives none (the card never asks above z16 anyway)
// A map tile that fails to load is asked once more after this delay (one transient error would otherwise
// leave a hole until the zoom, the size or the frame set changed).
const TILE_RETRY_MS = 5000;
// A forecast subscription that was rejected, or sent no message, is asked again after this long.
const FC_RETRY_MS = 60000;

/**
 * One delayed second request for a failed tile. The tile keeps its failed look meanwhile; a tile that is
 * no longer in the card (the map was rebuilt) is not asked again. onLoad runs when the second try loads.
 */
function retryTileOnce(img, url, onLoad) {
  setTimeout(() => {
    if (!img.isConnected) return;
    if (onLoad) img.addEventListener("load", onLoad, { once: true });
    img.src = url;
  }, TILE_RETRY_MS);
}
// A section greys when its own entity's data is older than this (minutes); the thresholds are the
// feed-health limits (AMeDAS 40 min, nowcast 20 min). The radar stamp shows the age
// from 5 min: a frame is "now" only while it is at most that old.
const STALE_AFTER_MIN = { weather: 40, rain: 20, frames: 20 };
const STAMP_AGE_MIN = 5;
// Play waits for every frame image to decode, but never longer than this.
const DECODE_TIMEOUT_MS = 6000;
// m/s -> the entity's wind unit (gust_max_today is native m/s; HA does not convert attributes)
const MS_TO = { "m/s": 1, "km/h": 3.6, mph: 2.23694, kn: 1.94384 };
const BAND_COLOURS = ["transparent", "#F2F2FF", "#A0D2FF", "#218CFF", "#0041FF",
  "#FAF500", "#FF9900", "#FF2800", "#B40068"];
const BAND_LABELS = ["", "<1", "1–5", "5–10", "10–20", "20–30", "30–50", "50–80", "80+"];
// English words for the bands; the Japanese terms are JMA's own (雨の強さと降り方) and JMA only
// names 10 mm/h and up, so bands 1–3 carry no Japanese term.
const INTENSITY = [
  null,
  { en: "drizzle", ja: "" },
  { en: "light", ja: "" },
  { en: "moderate", ja: "" },
  { en: "heavy", ja: "やや強い雨" },
  { en: "very heavy", ja: "強い雨" },
  { en: "intense", ja: "激しい雨" },
  { en: "violent", ja: "非常に激しい雨" },
  { en: "extreme", ja: "猛烈な雨" },
];
// Column height per band for the next-hour chart (fraction of the plot height).
const BAND_HEIGHT = [0, 0.14, 0.3, 0.44, 0.58, 0.7, 0.82, 0.92, 1];
// JMA's warning-level colours (the same scheme as キキクル)
const LEVEL_COLOURS = { 2: ["#F2E700", "#1a1a1a"], 3: ["#FF2800", "#ffffff"],
  4: ["#AA00AA", "#ffffff"], 5: ["#0C000C", "#ffffff"] };
// HA condition -> JMA icon (for the Open-Meteo hourly rows, which carry no JMA code)
const CONDITION_ICON = {
  sunny: ["100.svg", "500.svg"], "clear-night": ["500.svg", "500.svg"],
  partlycloudy: ["101.svg", "501.svg"], cloudy: ["200.svg", "200.svg"], fog: ["200.svg", "200.svg"],
  rainy: ["300.svg", "300.svg"], pouring: ["308.svg", "308.svg"], "lightning-rainy": ["300.svg", "300.svg"],
  "lightning": ["200.svg", "200.svg"], snowy: ["400.svg", "400.svg"], "snowy-rainy": ["300.svg", "300.svg"],
  hail: ["300.svg", "300.svg"], windy: ["200.svg", "200.svg"], "windy-variant": ["200.svg", "200.svg"],
  exceptional: ["200.svg", "200.svg"],
};
// HA condition slug -> plain words, for the gloss when JMA sends no English name
const CONDITION_WORDS = {
  "clear-night": "Clear night", cloudy: "Cloudy", exceptional: "Exceptional", fog: "Fog", hail: "Hail",
  lightning: "Thunder", "lightning-rainy": "Thunder and rain", partlycloudy: "Partly cloudy", pouring: "Heavy rain",
  rainy: "Rain", snowy: "Snow", "snowy-rainy": "Rain and snow", sunny: "Sunny", windy: "Windy", "windy-variant": "Windy and cloudy",
};
const conditionWords = (slug) => (slug == null ? "" : Object.prototype.hasOwnProperty.call(CONDITION_WORDS, slug) ? CONDITION_WORDS[slug] : String(slug));
// Temperature → colour stops for the 7-day range bars (°C)
const TEMP_STOPS = [[-5, "#7aa7ff"], [5, "#88d1eb"], [12, "#4cc3b5"], [18, "#7cdc6e"],
  [23, "#ffcf16"], [28, "#ffa25a"], [33, "#ff8a7a"], [38, "#ff6b86"]];
// ---- theme
// Colour tokens. The CSS reads only internal --jc-* names. Each one is defined as
//   var(--jma-card-<name>, var(--md-sys-color-<m3 name>, <Home Assistant variable(s)>, <literal for the mode>))
// so a card-mod / theme author sets --jma-card-<name>, a Material 3 theme is followed as it is, and an ordinary Home Assistant
// theme (which sets --primary-text-color, --card-background-color, ... for its own light or dark mode) needs nothing. The
// literal is the last resort (no theme at all): BASE_TOKENS carries one light and one dark value per token. The tonal layers
// (panel, well, tile and the containers) are mixed from the base tokens, so they follow a theme in either mode.
// Data scales (JMA's rain bands, warning levels, temperature stops, map legends) are fixed colours and are not tokens.
const BASE_TOKENS = [
  // [name, Material 3 name, Home Assistant variables (first wins), light literal, dark literal]
  ["ink", "on-surface", ["--primary-text-color"], "#1d1b20", "#e6e0e9"],
  ["muted", "on-surface-variant", ["--secondary-text-color"], "#49454f", "#cac4d0"],
  ["line", "outline-variant", ["--divider-color"], "#cac4d0", "#49454f"],
  ["outline", "outline", ["--outline-color"], "#79747e", "#938f99"],
  ["ground", "surface-container-low", ["--ha-card-background", "--card-background-color"], "#ffffff", "#1d1b20"],
  ["primary", "primary", ["--primary-color"], "#006a6a", "#81d5cc"],
  ["on-primary", "on-primary", ["--text-primary-color"], "#ffffff", "#003733"],
  ["secondary", "secondary", ["--primary-color"], "#4a6360", "#b1ccc8"],   // a selected chip is a tint of the theme's primary colour
  ["error", "error", ["--error-color"], "#b3261e", "#f2b8b5"],
  ["accent", "tertiary", [], "#9c4057", "#ffb2bc"],
  ["rain", null, [], "#00668b", "#88d1eb"],
];
const DERIVED_TOKENS = [
  // [name, Material 3 name, fallback mixed from the base tokens]
  ["panel", "surface-container-high", "color-mix(in srgb, var(--jc-ground), var(--jc-ink) 8%)"],
  ["well", "surface-container-highest", "color-mix(in srgb, var(--jc-ground), var(--jc-ink) 12%)"],
  ["tile", "surface-container", "color-mix(in srgb, var(--jc-ground), var(--jc-ink) 5%)"],
  ["primary-container", "primary-container", "color-mix(in srgb, var(--jc-primary) 24%, var(--jc-ground))"],
  ["on-primary-container", "on-primary-container", "var(--jc-ink)"],
  ["secondary-container", "secondary-container", "color-mix(in srgb, var(--jc-secondary) 22%, var(--jc-ground))"],
  ["on-secondary-container", "on-secondary-container", "var(--jc-ink)"],
  ["error-container", "error-container", "color-mix(in srgb, var(--jc-error) 22%, var(--jc-ground))"],
  ["on-error-container", "on-error-container", "var(--jc-ink)"],
  ["coral-container", null, "color-mix(in srgb, var(--jc-accent) 24%, var(--jc-ground))"],
  ["on-coral-container", null, "var(--jc-ink)"],
];
/** The `--jc-*: ...;` declarations of one mode ("light" or "dark"), as a string for the stylesheet. */
function tokenDecls(dark) {
  const decl = (name, m3, fallback) =>
    `--jc-${name}: var(--jma-card-${name}, ${m3 ? `var(--md-sys-color-${m3}, ${fallback})` : fallback});`;
  const base = BASE_TOKENS.map(([name, m3, ha, light, darkLit]) =>
    decl(name, m3, ha.reduceRight((inner, v) => `var(${v}, ${inner})`, dark ? darkLit : light)));
  const derived = DERIVED_TOKENS.map(([name, m3, mix]) => decl(name, m3, mix));
  return [...base, ...derived].join("\n          ");
}

// ---- configuration
// What the card needs from ha-jma: each role is one ha-jma entity, known by the translation_key ha-jma gives it
// (custom_components/jma/entity.py: unique_id = <area>_<translation_key>). The roles are found on the device of the
// configured weather entity; `entities.<role>` names one by hand and wins. A role with no entity only hides its part.
const SIBLING_KEYS = {
  warnings: "warning_level",
  rain: "rain_next_hour",
  frames: "radar_frames",       // disabled by default in ha-jma: enable it for the radar
  overview: "overview",
  feed: "feed_problem",
  quake: "last_earthquake",
  outlook: "warning_outlook",
  typhoon: "typhoon",
  wbgt: "wbgt",
  kikikuru: "kikikuru",
  rain_outlook: "rain_outlook",
  japan: "japan",               // disabled by default in ha-jma: enable it for the nationwide table
  tsunami: "tsunami",
  heat_alert: "heat_alert",
};
const SIBLING_ROLES = Object.keys(SIBLING_KEYS);
const ENTITY_ROLES = [...SIBLING_ROLES, "sun"];
const DEFAULT_SUN = "sun.sun";    // Home Assistant's own sun entity: day or night for the icons and the sunrise tile
const JMA_PLATFORM = "jma";
const LIGHTNING_KEYS = ["distance", "azimuth", "counter", "source", "minutes"];
const ENTITY_ID_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const DEFAULTS = {
  mode: "compact",
  title: "",         // card header text (inside the card); no header when empty
  icon: "",          // card header icon, e.g. mdi:weather-partly-cloudy (full mode)
  square: false,     // compact only: a 1:1 card while the drop-down is closed
  show_radar: true,  // compact only: false hides the radar thumbnail
  navigate: "",      // optional path opened when the radar or the next-hour chart is tapped (compact); none by default
  zoom: 10,          // compact thumbnail
  base_map: DEFAULT_BASE_MAP,   // "gsi" | "osm" | "esri", or {url, attribution, max_zoom} (YAML only)
  home: null,       // [lat, lon]; default: the radar_frames sensor's home, then Home Assistant's own lat/lon
  spans: [15, 60, 250, 3000],   // full-mode presets: km across the radar's width
  zoom_labels: ["Local", "Area", "Region", "Japan"],
  hours: 24,
};
const LIGHTNING_DEFAULTS = {
  source: "blitzortung",   // `source` attribute of the geo_location strike entities
  minutes: 30,             // a strike older than this is not drawn
};
// Full mode goes two-column (radar left, forecast right) from this card width (panel view).
const WIDE_AT = 880;
const TIGHT_BELOW = 400;    // a card narrower than this (a pop-up on a phone) takes the compact 7-day row
const NARROW_BELOW = 500;   // a card narrower than this (a phone) stacks its radar controls and the 全国 phrases
const OPEN_KEY = `${CARD_TAG}:open`;
const TAB_KEY = `${CARD_TAG}:tab`;
const LAYER_KEY = `${CARD_TAG}:layer`;
const RISK_KEY = `${CARD_TAG}:risk`;
// Credits. JMA's is always on the card; the others are added only while data from them is shown (_renderAttr).
// JMA's terms (https://www.jma.go.jp/jma/kishou/info/coment.html): the source as 「出典：気象庁ホームページ（page URL）」 and,
// separately, a statement that the content was edited. Open-Meteo (CC BY 4.0): a credit with a link next to the data.
const CREDITS = {
  jma: { text: "出典：気象庁ホームページ（https://www.jma.go.jp/bosai/）", href: "https://www.jma.go.jp/bosai/" },
  edited: { text: "気象庁の情報を加工して作成" },
  // the map credit is not here: it is the active base map's own (BASE_MAPS[...].credit, baseMapCredit())
  openmeteo: { text: "Weather data by Open-Meteo.com", href: "https://open-meteo.com/",
    title: "Open-Meteo.com, CC BY 4.0 (https://open-meteo.com/en/licence); hourly forecast and feels-like temperature" },
  wbgt: { text: "環境省 熱中症予防情報サイト", href: "https://www.wbgt.env.go.jp/" },
  p2p: { text: "P2P地震情報", href: "https://www.p2pquake.net/" },
  blitz: { text: "Blitzortung.org", href: "https://www.blitzortung.org/" },
};
// Compact drop-down tabs (one panel at a time keeps the card short).
const TABS = [
  { id: "warnings", ja: "警報", en: "Warnings" },
  { id: "hourly", ja: "毎時", en: "Hourly" },
  { id: "week", ja: "週間", en: "7 days" },
  { id: "details", ja: "詳細", en: "Details" },
];

const isEntityId = (v) => typeof v === "string" && ENTITY_ID_RE.test(v);

/** What is wrong with a custom tile template, as a phrase for the error message, or "" when it is usable. Only https, and
 * only the placeholders {z} {x} {y} (each at least once): the card fills nothing else, and an unfilled name would be
 * requested as it stands. (Same idea as weather-radar-card's check for placeholders its map library cannot fill.) */
function tileTemplateProblem(url) {
  if (!/^https:\/\//i.test(url)) return "must start with https://";
  if (/\s/.test(url)) return "must not contain spaces";
  const names = [...url.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const unknown = names.filter((n) => !["z", "x", "y"].includes(n));
  if (unknown.length) return `has an unknown placeholder {${unknown[0]}} (only {z}, {x} and {y} are filled)`;
  if (/[{}]/.test(url.replace(/\{[zxy]\}/g, ""))) return "has a stray { or }";
  const missing = ["z", "x", "y"].filter((n) => !names.includes(n));
  if (missing.length) return `needs ${missing.map((n) => `{${n}}`).join(", ")} in the address`;
  // the host is plain text before the first / ? #: no placeholder in it, and "https:///x" (which URL() reads as host "x") is not one
  if (!/^https:\/\/[^/?#{}]+/i.test(url)) return "has no host name";
  let parsed;
  try { parsed = new URL(url.replace(/\{[zxy]\}/g, "0")); } catch (e) { return "is not a valid address"; }
  if (!parsed.hostname) return "has no host name";
  if (parsed.username || parsed.password) return "must not carry a user name or password (put a key in the query instead)";
  return "";
}

/** The host of a tile template ("" when it has none): the credit's fallback text, never the path, query or any key in it. */
function tileHost(url) {
  try { return new URL(String(url).replace(/\{[zxy]\}/g, "0")).host; } catch (e) { return ""; }
}

/** `base_map`: a name from BASE_MAPS, or {url, attribution, max_zoom}. Returns the name, or the checked mapping. */
function parseBaseMap(v, fail) {
  if (v == null || v === "") return DEFAULT_BASE_MAP;   // an empty value is "not set", as for the entity ids
  const shape = `\`base_map\` must be ${BASE_MAP_IDS.join(", ")} or a mapping with a url (url, attribution, max_zoom)`;
  if (typeof v === "string") {
    if (!BASE_MAP_IDS.includes(v)) fail(`${shape}, not "${v}"`);
    return v;
  }
  if (typeof v !== "object" || Array.isArray(v)) fail(shape);
  for (const k of Object.keys(v)) if (!CUSTOM_BASE_KEYS.includes(k)) fail(`unknown key base_map.${k} (allowed: ${CUSTOM_BASE_KEYS.join(", ")})`);
  if (typeof v.url !== "string" || !v.url.trim()) fail("`base_map.url` must be an https tile address with {z}, {x} and {y}, for example https://tiles.example.org/{z}/{x}/{y}.png");
  const url = v.url.trim();
  const problem = tileTemplateProblem(url);
  if (problem) fail(`base_map.url ${problem}`);
  if (v.attribution != null && typeof v.attribution !== "string") fail("`base_map.attribution` must be text");
  let maxZoom = CUSTOM_MAX_ZOOM;
  if (v.max_zoom != null) {
    maxZoom = +v.max_zoom;
    if (!Number.isInteger(maxZoom) || maxZoom < 2 || maxZoom > 22) fail("`base_map.max_zoom` must be a whole number from 2 to 22");
  }
  return { url, attribution: (v.attribution || "").trim(), max_zoom: maxZoom };
}

/**
 * The base map to draw for a normalised `base_map`: {id, url, labelUrl, maxZoom, credit: {text, href?, title?}, terms}.
 * id is gsi / osm / esri / custom. A custom credit is the configured text, or "Map tiles: <host>": a map is never unnamed.
 */
function resolveBaseMap(spec) {
  const s = spec == null ? DEFAULT_BASE_MAP : spec;
  if (typeof s === "string" && Object.prototype.hasOwnProperty.call(BASE_MAPS, s)) return { id: s, ...BASE_MAPS[s] };
  if (s && typeof s === "object" && !Array.isArray(s) && typeof s.url === "string" && s.url) {
    const host = tileHost(s.url);
    return { id: "custom", url: s.url, labelUrl: "", maxZoom: Number.isInteger(+s.max_zoom) && +s.max_zoom >= 2 ? +s.max_zoom : CUSTOM_MAX_ZOOM,
      credit: { text: s.attribution || (host ? `Map tiles: ${host}` : "Map tiles"), title: host ? `Base map: custom tiles from ${host}` : "Base map: custom tiles" }, terms: "" };
  }
  return { id: DEFAULT_BASE_MAP, ...BASE_MAPS[DEFAULT_BASE_MAP] };
}

/** The map credit line for a base map: {id: "map", text, href?, title?}. */
function baseMapCredit(spec) {
  return { id: "map", ...resolveBaseMap(spec).credit };
}

/**
 * Validate a card configuration and fill the defaults. Throws an Error whose message Home Assistant shows in the
 * card's place. Returns {entity, mode, title, icon, square, show_radar, base_map, navigate, zoom, home, spans, zoom_labels, hours,
 * entities: {role: id}, lightning: {distance, azimuth, counter, source, minutes}, alert_entity}. `base_map` is a name
 * ("gsi", "osm", "esri") or the checked custom mapping {url, attribution, max_zoom}. Unknown top-level
 * keys (type, grid_options, visibility ...) are Home Assistant's and are left alone.
 */
function normaliseConfig(config) {
  const fail = (msg) => { throw new Error(`ha-jma-card: ${msg}`); };
  if (!config || typeof config !== "object" || Array.isArray(config)) fail("the configuration must be a mapping");
  const c = config;
  if (typeof c.entity !== "string" || !c.entity) fail("set `entity` to a JMA weather entity, for example weather.jma_chiyoda");
  if (!isEntityId(c.entity) || !c.entity.startsWith("weather.")) fail(`\`entity\` must be a weather entity (weather.…), not "${c.entity}"`);
  const mode = c.mode == null ? DEFAULTS.mode : c.mode;
  if (!["compact", "full"].includes(mode)) fail("mode must be compact or full");
  const text = (key) => {
    if (c[key] == null) return DEFAULTS[key];
    if (typeof c[key] !== "string") fail(`\`${key}\` must be text`);
    return c[key];
  };
  const bool = (key) => {
    if (c[key] == null) return DEFAULTS[key];
    if (typeof c[key] !== "boolean") fail(`\`${key}\` must be true or false`);
    return c[key];
  };
  const entities = {};
  if (c.entities != null) {
    if (typeof c.entities !== "object" || Array.isArray(c.entities)) fail("`entities` must be a mapping of role to entity id");
    for (const [role, id] of Object.entries(c.entities)) {
      if (!ENTITY_ROLES.includes(role)) fail(`unknown key entities.${role} (allowed: ${ENTITY_ROLES.join(", ")})`);
      if (id == null || id === "") continue;
      if (!isEntityId(id)) fail(`entities.${role} must be an entity id such as sensor.jma_chiyoda_${SIBLING_KEYS[role] || "x"}`);
      entities[role] = id;
    }
  }
  const lightning = { distance: "", azimuth: "", counter: "", ...LIGHTNING_DEFAULTS };
  if (c.lightning != null) {
    if (typeof c.lightning !== "object" || Array.isArray(c.lightning)) fail("`lightning` must be a mapping (distance, azimuth, counter, source, minutes)");
    for (const [k, v] of Object.entries(c.lightning)) {
      if (!LIGHTNING_KEYS.includes(k)) fail(`unknown key lightning.${k} (allowed: ${LIGHTNING_KEYS.join(", ")})`);
      if (v == null || v === "") continue;
      if (k === "minutes") {
        if (!Number.isFinite(+v) || +v <= 0) fail("lightning.minutes must be a positive number");
        lightning.minutes = +v;
      } else if (k === "source") {
        if (typeof v !== "string") fail("lightning.source must be text");
        lightning.source = v;
      } else {
        if (!isEntityId(v)) fail(`lightning.${k} must be an entity id`);
        lightning[k] = v;
      }
    }
  }
  if (c.alert_entity != null && c.alert_entity !== "" && !isEntityId(c.alert_entity)) fail("`alert_entity` must be an entity id");
  const zoom = c.zoom == null ? DEFAULTS.zoom : +c.zoom;
  if (!Number.isFinite(zoom) || zoom < 3 || zoom > 16) fail("`zoom` must be a number from 3 to 16");
  const hours = c.hours == null ? DEFAULTS.hours : +c.hours;
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) fail("`hours` must be a whole number from 1 to 72");
  let spans = DEFAULTS.spans;
  if (c.spans != null) {
    if (!Array.isArray(c.spans) || !c.spans.length || c.spans.some((v) => !Number.isFinite(+v) || +v <= 0)) fail("`spans` must be a list of distances in km, for example [15, 60, 250, 3000]");
    spans = c.spans.map(Number);
  }
  let zoomLabels = DEFAULTS.zoom_labels;
  if (c.zoom_labels != null) {
    if (!Array.isArray(c.zoom_labels) || c.zoom_labels.some((v) => typeof v !== "string")) fail("`zoom_labels` must be a list of text");
    zoomLabels = c.zoom_labels;
  }
  if (c.home != null && !homeLatLon(c.home, null, null)) fail("`home` must be [latitude, longitude]");
  const baseMap = parseBaseMap(c.base_map, fail);
  return {
    entity: c.entity, mode, title: text("title"), icon: text("icon"), square: bool("square"), show_radar: bool("show_radar"),
    base_map: baseMap, navigate: text("navigate"), zoom, home: c.home == null ? null : c.home, spans, zoom_labels: zoomLabels, hours,
    entities, lightning, alert_entity: c.alert_entity || "",
  };
}

/**
 * The ha-jma entities on the same device as the weather entity, by role: {warnings: "sensor.…", …}. They are read from
 * the entity registry Home Assistant gives the frontend (`hass.entities`: device_id, platform, translation_key).
 * A weather entity that is not in the registry (or has no device) finds nothing.
 */
function discoverSiblings(hass, entityId) {
  const reg = hass && hass.entities;
  const me = reg && reg[entityId];
  if (!me || !me.device_id) return {};
  const role = {};
  for (const r of SIBLING_ROLES) role[SIBLING_KEYS[r]] = r;
  const found = {};
  for (const id of Object.keys(reg).sort()) {
    const e = reg[id];
    if (!e || e.device_id !== me.device_id || e.platform !== JMA_PLATFORM || !Object.prototype.hasOwnProperty.call(role, e.translation_key)) continue;
    if (!found[role[e.translation_key]]) found[role[e.translation_key]] = id;
  }
  return found;
}

/** Every entity id the card reads, by role: explicit config first, then the discovered sibling, else null. */
function resolveRoles(config, hass) {
  const found = discoverSiblings(hass, config.entity);
  const roles = { entity: config.entity };
  for (const r of SIBLING_ROLES) roles[r] = config.entities[r] || found[r] || null;
  roles.sun = config.entities.sun || DEFAULT_SUN;
  roles.lightning_distance = config.lightning.distance || null;
  roles.lightning_azimuth = config.lightning.azimuth || null;
  roles.lightning_counter = config.lightning.counter || null;
  roles.alert_latest = config.alert_entity || null;
  return roles;
}

/** The first ha-jma weather entity of the registry that has a state (else the first), for the card picker's stub. */
function pickStubEntity(hass) {
  const reg = (hass && hass.entities) || {};
  const states = (hass && hass.states) || {};
  const ids = Object.keys(reg).filter((id) => id.startsWith("weather.") && reg[id] && reg[id].platform === JMA_PLATFORM).sort();
  return ids.find((id) => states[id]) || ids[0] || "";
}

// ------------------------------------------------------------------ pure helpers

function bandColour(band) {
  return BAND_COLOURS[Math.max(0, Math.min(8, band || 0))];
}

function levelColour(level) {
  return LEVEL_COLOURS[level] || ["var(--jc-well)", "var(--jc-ink)"];
}

function parseJmaTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value || "");
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/**
 * One Intl.DateTimeFormat per (locale, options), built on first use and reused: building
 * one costs ~0.1-0.3 ms and a render formats dozens of times on a wall display. Same text as before;
 * a bad time zone still throws RangeError and nothing is cached for it.
 */
const DTF_CACHE = new Map();
function dtf(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = DTF_CACHE.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    DTF_CACHE.set(key, f);
  }
  return f;
}

/**
 * The language of the English-side dates and numbers: Home Assistant's own (`hass.locale.language`), set by the card on
 * every hass update. "en" stays en-GB (day before month: "30 Sep", "Thu 1 Oct"); a tag Intl does not know falls back to it.
 * Times are always 24-hour HH:MM and the Japanese-side dates (月日, 曜日, 10/1 21時) are always Japanese: both are
 * parsed back or compared in places, and they are JMA's own style. Digits are Latin.
 */
const DEFAULT_LOCALE = "en-GB";
let LOCALE = DEFAULT_LOCALE;
function uiLocale(language) {
  if (typeof language !== "string" || !language || language === "en") return DEFAULT_LOCALE;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([language]).length ? `${language}-u-nu-latn` : DEFAULT_LOCALE;
  } catch (e) {
    return DEFAULT_LOCALE;
  }
}
function setLocale(language) {
  LOCALE = uiLocale(language);
  return LOCALE;
}

function fmtTime(date, tz) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return dtf("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz || FALLBACK_TZ,
  }).format(date);
}

function fmtHour(date, tz) {
  return fmtTime(date, tz).slice(0, 2);
}

function fmtDay(date, tz) {
  if (!date || Number.isNaN(date.getTime())) return { ja: "", md: "", jmd: "", full: "" };
  const opts = { timeZone: tz || FALLBACK_TZ };
  const ja = dtf("ja-JP", { ...opts, weekday: "short" }).format(date);
  // Japanese-first date for the 全国 day tabs and the weekly rows ("10月25日"); `md` stays for English sentences
  const jp = Object.fromEntries(dtf("ja-JP", { ...opts, month: "numeric", day: "numeric" }).formatToParts(date).map((p) => [p.type, p.value]));
  const jmd = `${jp.month}月${jp.day}日`;
  // "30 Sep" and "Thu 1 Oct" (en-GB writes September "Sept"); a date inside a Japanese phrase keeps JMA's "10/1" (mdHourJa)
  const md = dtf(LOCALE, { ...opts, day: "numeric", month: "short" }).format(date).replace("Sept", "Sep");
  const wd = dtf(LOCALE, { ...opts, weekday: "short" }).format(date);
  return { ja, md, jmd, full: `${wd} ${md}` };
}

/** A Date from an ISO string / ms / Date, or null when it does not parse (never a RangeError later). */
function toDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD of a date in the time zone (sortable). */
function dayKey(date, tz) {
  return dtf("en-CA", { timeZone: tz || FALLBACK_TZ }).format(date);
}

/** "12 min ago" / "1 h 5 min ago". */
function ageText(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

/** "JMA data from 23:05 · 45 min old" (with the day, "29 Sep 23:05", when it is not today in the zone). */
function staleText(date, nowMs, tz) {
  const d = toDate(date);
  if (!d) return "No data";
  const day = dayKey(d, tz) !== dayKey(new Date(nowMs), tz) ? `${fmtDay(d, tz).md} ` : "";
  return `JMA data from ${day}${fmtTime(d, tz)} · ${ageText(nowMs - d.getTime()).replace(" ago", " old")}`;
}

/**
 * Staleness of ONE section from its own entity: {stale, text}.
 * weather: AMeDAS observed_at · rain / frames: the nowcast basetime · warnings: availability only
 * (its report_time can legitimately be days old).
 */
function sectionStale(kind, st, nowMs, tz) {
  if (!st || st.state === "unavailable" || st.state === "unknown") return { stale: true, text: "No data" };
  const a = st.attributes || {};
  let t = null;
  if (kind === "weather") t = toDate(a.observed_at);
  else if (kind === "rain" || kind === "frames") t = parseJmaTime(a.basetime);
  if (!t || !STALE_AFTER_MIN[kind]) return { stale: false, text: "" };
  if (nowMs - t.getTime() > STALE_AFTER_MIN[kind] * 60000) return { stale: true, text: staleText(t, nowMs, tz) };
  return { stale: false, text: "" };
}

/** jma_url only when it points at www.jma.go.jp over https. */
function safeJmaUrl(url) {
  return typeof url === "string" && JMA_URL_RE.test(url) ? url : null;
}

function pillText(w) {
  return { text: w.name_ja || w.code, title: `${w.name_en || ""} (${w.status || ""})` };
}

function frameList(attrs) {
  if (!attrs || !attrs.basetime) return [];
  const base = attrs.basetime;
  const past = (attrs.past || []).map((v) => ({ basetime: v, validtime: v, kind: v === base ? "now" : "past" }));
  // a basetime that is not among the past frames: the newest past frame stands in as "now"
  if (past.length && !past.some((f) => f.kind === "now")) past[past.length - 1].kind = "now";
  const fc = (attrs.forecast || []).map((v) => ({ basetime: base, validtime: v, kind: "forecast" }));
  return [...past, ...fc];
}

/** Stamp text. The latest frame says "now" only while it is under STAMP_AGE_MIN old (nowMs given). */
function frameLabel(frame, base, tz, nowMs) {
  const t = parseJmaTime(frame.validtime);
  const b = parseJmaTime(base);
  if (!t || !b) return "";
  const mins = Math.round((t - b) / 60000);
  if (frame.kind === "now") {
    const age = nowMs == null ? 0 : nowMs - t.getTime();
    return age > STAMP_AGE_MIN * 60000 ? `${fmtTime(t, tz)} · ${ageText(age)}` : `${fmtTime(t, tz)} now`;
  }
  return `${fmtTime(t, tz)} ${mins > 0 ? "+" : "−"}${Math.abs(mins)} min`;
}

/** Where the scrubber marks sit: now tick and the forecast segment, as fractions of the track. */
function scrubMarks(frames) {
  const n = (frames || []).length;
  if (n < 2) return { now: 0, fcFrom: null };
  const nowIdx = Math.max(0, frames.findIndex((f) => f.kind === "now"));
  const hasFc = frames.some((f) => f.kind === "forecast");
  return { now: nowIdx / (n - 1), fcFrom: hasFc ? nowIdx / (n - 1) : null };
}

/**
 * Web-Mercator zoom (fractional) at which `widthPx` spans `spanKm` at latitude `lat`.
 * The same span covers the same ground whatever the screen (the default presets are about 15, 60, 250 and 3000 km across).
 */
function spanZoom(widthPx, spanKm, lat) {
  const metresPerPxZ0 = 156543.03392 * Math.cos((lat * Math.PI) / 180);
  const z = Math.log2((metresPerPxZ0 * Math.max(1, widthPx)) / (spanKm * 1000));
  return Math.max(3, Math.min(16, z));
}

/** Home for the radar: config `home` ([lat, lon] or {latitude, longitude}), then the sensor's, then HA's. */
function homeLatLon(configHome, sensorHome, haConfig) {
  const pair = (v) => {
    if (Array.isArray(v) && v.length >= 2 && Number.isFinite(+v[0]) && Number.isFinite(+v[1])) return [+v[0], +v[1]];
    if (v && typeof v === "object" && Number.isFinite(+v.latitude) && Number.isFinite(+v.longitude)) return [+v.latitude, +v.longitude];
    return null;
  };
  return pair(configHome) || pair(sensorHome) || pair(haConfig);
}

function tileUrl(template, frame, z, x, y) {
  return fillTemplate(template, frame, z, x, y);
}

function worldPx(lat, lon, z) {
  const n = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

/** Tiles at dataZ covering a w×h view centred on lat/lon at viewZ (dataZ ≤ viewZ upscales). */
function gridTiles(lat, lon, viewZ, dataZ, w, h) {
  const scale = 2 ** (viewZ - dataZ);
  const size = 256 * scale;
  const [cx, cy] = worldPx(lat, lon, dataZ);
  const left0 = cx * scale - w / 2;
  const top0 = cy * scale - h / 2;
  const tiles = [];
  for (let x = Math.floor(left0 / size); x <= Math.floor((left0 + w - 1) / size); x++) {
    for (let y = Math.floor(top0 / size); y <= Math.floor((top0 + h - 1) / size); y++) {
      tiles.push({ x, y, left: x * size - left0, top: y * size - top0, size });
    }
  }
  return tiles;
}

function intensityText(band) {
  const i = INTENSITY[band];
  if (!i) return "";
  return `${BAND_LABELS[band]} mm/h ${i.ja || i.en}`;
}

/** Next-hour headline: {title, sub}. The sentence names the time and JMA's intensity. */
function nextHourText(attrs, tz, nowMs) {
  if (!attrs || !Array.isArray(attrs.series) || !attrs.series.length) {
    return { title: "No nowcast frames", sub: "" };
  }
  const s = attrs.series;
  // Only the observed frame came through (JMA's forecast list lags; review C3): say what is known.
  if (s.length < 2) {
    return { title: attrs.raining_now ? "Raining now" : "Dry now", sub: "no next-hour frames" };
  }
  const peak = Math.max(...s.map((p) => p.band || 0));
  // a time on tomorrow's date says "tomorrow" (the hero tile's rainWords says the same)
  const today = dayKey(new Date(nowMs == null ? Date.now() : nowMs), tz);
  const at = (p) => {
    const d = new Date(p.time);
    return `${!Number.isNaN(d.getTime()) && dayKey(d, tz) > today ? "tomorrow " : ""}${fmtTime(d, tz)}`;
  };
  if (attrs.raining_now) {
    const stop = s.slice(1).find((p) => p.band !== null && (p.band || 0) < 2);
    return {
      title: stop ? `Rain easing ~${at(stop)}` : "Raining for the next hour",
      sub: `now ${intensityText(s[0].band)}${peak > (s[0].band || 0) ? ` · peak ${INTENSITY[peak].en}` : ""}`,
    };
  }
  if (attrs.minutes_to_rain != null) {
    const i = Math.max(1, s.findIndex((p) => p.minutes === attrs.minutes_to_rain));
    const first = s[i];
    const stop = s.slice(i + 1).find((p) => p.band !== null && (p.band || 0) < 2);
    return {
      title: `Rain from ~${at(first)}`,
      sub: `in ${attrs.minutes_to_rain} min${stop ? ` · until ~${at(stop)}` : ""} · peak ${intensityText(peak)}`,
    };
  }
  if (s.some((p) => p.band === 1)) return { title: "Drizzle nearby", sub: "under 1 mm/h" };
  return { title: "No rain in the next hour", sub: `JMA nowcast ${at(s[0])}` };
}

/** Axis labels under the 13 columns: indices 0,3,6,9,12 → Now, +15 … +60. */
function axisLabels(series, tz) {
  return [0, 3, 6, 9, 12].filter((i) => series && series[i]).map((i) => ({
    index: i, text: i === 0 ? "Now" : `+${series[i].minutes}`, time: fmtTime(new Date(series[i].time), tz),
  }));
}

function conditionIcon(condition, night) {
  const pair = CONDITION_ICON[condition] || CONDITION_ICON.cloudy;
  return pair[night ? 1 : 0];
}

/** the Material (mdi) weather symbol for a JMA forecast code ("313.svg" / 313 / "313"), for the compact card; `night` turns a
 *  clear day into the moon. Digits: 1xx sunny-first, 2xx cloudy-first, 3xx rain, 4xx snow. Unknown / missing code -> weather-cloudy. */
function jmaSymbol(code, night) {
  const m = /(\d{3})/.exec(String(code == null ? "" : code));
  if (!m) return "weather-cloudy";
  const c = Number(m[1]);
  const d = Math.floor(c / 100);
  const among = (...list) => list.indexOf(c) !== -1;
  if (among(130, 131, 209, 231)) return "weather-fog";
  if (d === 4) {
    if (among(405, 406, 407, 425)) return "weather-snowy-heavy";
    if (among(403, 409, 414, 422, 423, 426, 427)) return "weather-snowy-rainy";
    return "weather-snowy";
  }
  if (d === 3) {
    if (among(306, 308, 328)) return "weather-pouring";
    if (c === 350) return "weather-lightning-rainy";
    if (among(303, 304, 309, 314, 315, 316, 317, 322, 326, 327, 329, 340, 361, 371)) return "weather-snowy-rainy";
    if (among(301, 311, 320, 323, 324, 325)) return "weather-partly-rainy";   // rain WITH 晴 (a sun in the picture)
    return "weather-rainy";
  }
  if (d === 2) {
    if (among(208, 219, 240, 250)) return "weather-lightning-rainy";
    if (among(204, 205, 206, 207, 215, 216, 217, 218, 228, 229, 230, 260, 270, 281)) return "weather-snowy";
    if (among(202, 203, 212, 213, 214, 220, 221, 222, 224, 225, 226)) return "weather-rainy";
    if (among(201, 210, 211, 223)) return "weather-partly-cloudy";
    return "weather-cloudy";
  }
  if (d === 1) {
    if (among(108, 119, 125, 140)) return "weather-lightning-rainy";
    if (among(104, 105, 106, 107, 115, 116, 117, 118, 124, 160, 170, 181)) return "weather-partly-snowy";
    if (among(102, 103, 112, 113, 114, 120, 121, 122, 123, 126, 127, 128)) return "weather-partly-rainy";
    if (among(101, 110, 111, 132)) return "weather-partly-cloudy";
    return night ? "weather-night" : "weather-sunny";
  }
  return "weather-cloudy";
}

/** Temperature → hex colour, interpolated between TEMP_STOPS. */
function tempColour(t) {
  if (t == null) return "var(--jc-muted)";
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (t <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      const [a, b] = [hex(c0), hex(c1)];
      return `#${a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}

/** Position of a lo–hi bar on the week's scale, in percent. Missing ends collapse to a dot. */
function rangeBar(lo, hi, weekMin, weekMax) {
  const span = Math.max(1, weekMax - weekMin);
  const a = lo == null ? hi : lo;
  const b = hi == null ? lo : hi;
  if (a == null) return null;
  const left = ((a - weekMin) / span) * 100;
  const width = Math.max(((b - a) / span) * 100, 3);
  return { left: Math.max(0, Math.min(100 - width, left)), width };
}

const EN_FIXES = [[/rainorsnow/i, "Rain or snow"], [/snoworrain/i, "Snow or rain"],
  [/heavysnowstorm/i, "Heavy snowstorm"], [/heavyrain/i, "Heavy rain"], [/heavysnow/i, "Heavy snow"],
  [/sccatered/gi, "scattered"]];

/** Tidy JMA's English weather labels ("Rain,Cloudy Later" -> "Rain, cloudy later"). */
function prettyEn(label) {
  if (!label) return "";
  let s = String(label);
  for (const [re, to] of EN_FIXES) s = s.replace(re, to);
  s = s.replace(/\s*,\s*/g, ", ").replace(/\s{2,}/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function compass(deg) {
  if (deg == null) return "";
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round(deg / 22.5) % 16];
}

/** the footer as labelled pairs [{label, value}], the detail sheet's wording. */
function summaryParts(a) {
  if (!a) return [];
  const parts = [];
  if (a.humidity != null) parts.push({ label: "Humidity", value: `${a.humidity}%` });
  if (a.wind_speed != null) parts.push({ label: "Wind", value: [Number(a.wind_speed).toFixed(1), a.wind_speed_unit, compass(a.wind_bearing)].filter(Boolean).join(" ") });
  if (a.pressure != null) parts.push({ label: "Pressure", value: `${Math.round(a.pressure)} ${a.pressure_unit || "hPa"}` });
  if (a.precip_24h != null) parts.push({ label: "Rain 24 h", value: `${a.precip_24h} mm` });
  return parts;
}

function summaryLine(a) {
  if (!a) return "";
  const parts = [];
  if (a.humidity != null) parts.push(`${a.humidity}%`);
  // the entity's own unit only (live: km/h); never assume m/s
  if (a.wind_speed != null) parts.push([Number(a.wind_speed).toFixed(1), a.wind_speed_unit, compass(a.wind_bearing)].filter(Boolean).join(" "));
  if (a.pressure != null) parts.push(`${Math.round(a.pressure)} ${a.pressure_unit || "hPa"}`);
  if (a.precip_24h != null) parts.push(`${a.precip_24h} mm 24h`);
  return parts.join(" · ");
}

/**
 * gust_max_today is native m/s (an extra attribute, so HA never converts it): into the entity's
 * wind unit. An unknown or missing unit stays in m/s, labelled as such. {value, unit} or null.
 */
function gustInUnit(ms, unit) {
  if (ms == null || ms === "" || !Number.isFinite(+ms)) return null;
  const k = MS_TO[unit];
  return k ? { value: +ms * k, unit } : { value: +ms, unit: "m/s" };
}

/** Start (ms) of the current hour in the zone (works for :30/:45 offsets too). */
function hourStart(nowMs, tz) {
  const d = new Date(nowMs);
  const parts = dtf("en-GB", { timeZone: tz || FALLBACK_TZ, minute: "2-digit", second: "2-digit" })
    .formatToParts(d);
  const get = (type) => +(parts.find((p) => p.type === type) || { value: 0 }).value;
  return nowMs - get("minute") * 60000 - get("second") * 1000 - d.getMilliseconds();
}

/** Hourly rows from the current hour on (older rows dropped; unparseable times skipped). */
function hourlyRows(rows, nowMs, tz, n) {
  const start = hourStart(nowMs, tz);
  return (rows || []).filter((r) => {
    const t = toDate(r && r.datetime);
    return t && t.getTime() >= start;
  }).slice(0, n == null ? 24 : n);
}

/**
 * Night at time t, from sun.sun's next_rising / next_setting (both in the future): t is night when
 * the last sunset before t is later than the last sunrise before t, the two times repeated daily.
 * Gives [sunset−24h, sunrise) ∪ [sunset, …) when it is night now, and marks the NEXT evening as night.
 */
function isNight(t, rise, set) {
  const tm = toDate(t);
  const r = toDate(rise);
  const s = toDate(set);
  if (!tm || !r || !s) return false;
  const D = 86400000;
  const last = (x) => x + Math.floor((tm.getTime() - x) / D) * D;
  return last(s.getTime()) > last(r.getTime());
}

/**
 * The 6-h rain chances still to come: finished slots dropped, JMA's "18–24" form, the weekday ("Fri")
 * on the slots of a later day. [{label, pop, tomorrow, current}]
 */
function popSlots(pops, nowMs, tz) {
  const today = dayKey(new Date(nowMs), tz);
  const out = [];
  for (const p of pops || []) {
    const t = toDate(p && p.time);
    if (!t) continue;
    const end = new Date(t.getTime() + 6 * 3600000);
    if (end.getTime() <= nowMs) continue;
    const eh = fmtHour(end, tz);
    const tomorrow = dayKey(t, tz) > today;
    out.push({
      label: `${tomorrow ? `${dtf("ja-JP", { timeZone: tz || FALLBACK_TZ, weekday: "short" }).format(t)} ` : ""}${fmtHour(t, tz)}–${eh === "00" ? "24" : eh}`,
      pop: p.pop, tomorrow, current: t.getTime() <= nowMs,
    });
  }
  return out;
}

/**
 * The last-quake line: "9月27日 14:05 · 千葉県北西部 · M4.6 · 最大震度3 · 東京都２３区 震度2 · 千代田区 震度1" ("–" where missing).
 * The place names are the integration's own, from the last-earthquake sensor: `area` (the JMA area it watches; else the
 * prefecture `pref` stands in) with `area_shindo` / `pref_shindo`, and `local_name` with `local_shindo`.
 * A part whose name the sensor does not give is left out.
 */
function quakeLine(st, tz) {
  if (!st) return "";
  const a = st.attributes || {};
  const t = toDate(a.time) || toDate(st.state);
  if (!t && a.hypocenter == null && a.magnitude == null) return "–";
  const dash = (v) => (v == null || v === "" ? "–" : String(v));
  const name = (v) => (typeof v === "string" ? v.trim() : "");
  const mdp = t ? dtf("en-GB", { timeZone: tz || FALLBACK_TZ, month: "numeric", day: "numeric" }).formatToParts(t) : [];
  const mdv = (type) => +((mdp.find((q) => q.type === type) || { value: 0 }).value);
  const when = t ? `${mdv("month")}月${mdv("day")}日 ${fmtTime(t, tz)}` : "–";
  const mag = a.magnitude == null || a.magnitude === "" ? "–" : Number(a.magnitude).toFixed(1);
  const parts = [when, dash(a.hypocenter), `M${mag}`, `最大震度${dash(a.max_shindo)}`];
  if (name(a.area)) parts.push(`${name(a.area)} 震度${dash(a.area_shindo)}`);
  else if (name(a.pref)) parts.push(`${name(a.pref)} 震度${dash(a.pref_shindo)}`);
  if (name(a.local_name) || a.local_shindo != null) parts.push(`${name(a.local_name) || "地点"} 震度${dash(a.local_shindo)}`);
  return parts.join(" · ");
}

// --------- more JMA data

/** An entity's attributes when it exists and has a state; null when missing / unavailable / unknown. */
function liveAttrs(st) {
  return st && st.state !== "unavailable" && st.state !== "unknown" ? st.attributes || {} : null;
}

const num = (v) => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);

/** Short Japanese names for the warning-outlook phenomena (the warnings sensor's keys). */
const PHEN_SHORT = {
  rain: "大雨", landslide: "土砂", tide: "高潮", wind: "強風", wind_snow: "風雪", snow: "大雪",
  wave: "波浪", thunder: "雷", snow_melting: "融雪", fog: "濃霧", dry: "乾燥", avalanche: "なだれ",
  cold: "低温", frost: "霜", ice_accretion: "着氷", snow_accretion: "着雪",
};
/** JMA's timeline page words for "a warning of this level is possible". */
const OUTLOOK_WORD = { 2: "注意報級", 3: "警報級", 4: "危険警報級", 5: "特別警報級" };

/** 強風 at L2 becomes 暴風 from L3; an unknown key keeps its raw name without 危険度. */
function phenShort(key, level) {
  if (key === "wind" && level >= 3) return "暴風";
  if (key === "wind_snow" && level >= 3) return "暴風雪";
  return PHEN_SHORT[key] || String(key || "").replace(/危険度$/, "");
}

/** Highest level in a {phenomenon: level} map (0 when empty). */
function maxLevel(levels) {
  const v = Object.values(levels || {}).map(num).filter((x) => x != null);
  return v.length ? Math.max(0, ...v) : 0;
}

/** hour label that says 24 for a midnight END ("18–24時"). */
function endHour(date, tz) {
  const h = fmtHour(date, tz);
  return h === "00" ? "24" : h;
}

/**
 * The 警報 section's "next 24 h" strip: up to 8 three-hour cells.
 * [{label, level, phen[], rain, title, newDay}] — phen only for levels ≥ 2, highest first.
 */
function outlookCells(attrs, tz, nowMs) {
  const steps = (attrs && Array.isArray(attrs.steps) ? attrs.steps : []).filter((s) => s && toDate(s.start)).slice(0, 8);
  const today = dayKey(new Date(nowMs == null ? Date.now() : nowMs), tz);
  let prevDay = null;
  let markedTomorrow = false;
  return steps.map((s) => {
    const t = toDate(s.start);
    const end = toDate(s.end) || new Date(t.getTime() + 3 * 3600000);
    const day = dayKey(t, tz);
    const levels = s.levels && typeof s.levels === "object" ? s.levels : {};
    const level = maxLevel(levels);
    const phen = Object.entries(levels).map(([k, v]) => [k, num(v)]).filter(([, v]) => v != null && v >= 2)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => phenShort(k, v));
    const tomorrow = day > today;
    const newDay = tomorrow && !markedTomorrow && (prevDay == null || prevDay !== day);
    if (newDay) markedTomorrow = true;
    prevDay = day;
    const rain = num(s.rain_1h_mm);
    const hh = fmtHour(t, tz);
    const words = Object.entries(levels).map(([k, v]) => [k, num(v)]).filter(([, v]) => v != null && v >= 2)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${phenShort(k, v)} ${OUTLOOK_WORD[v] || `L${v}`}`);
    return {
      label: newDay ? `明日 ${hh}` : hh, level, phen, rain, newDay,
      title: [`${hh}–${endHour(end, tz)}時`, ...words, rain == null ? null : `1時間最大 ${rain} mm`].filter(Boolean).join(" · "),
    };
  });
}

/**
 * Compact card line for the outlook peak: 「見通し 雷(注意報級) 06–18時」, or "" when the peak is < 2.
 * The span is the first run of consecutive steps at the peak level from peak.start.
 */
function outlookLine(attrs, tz, nowMs) {
  const peak = attrs && attrs.peak;
  const level = peak ? num(peak.level) : null;
  if (!peak || level == null || level < 2) return "";
  const phen = (Array.isArray(peak.phenomena) ? peak.phenomena : []).map((k) => phenShort(k, level));
  const steps = (Array.isArray(attrs.steps) ? attrs.steps : []).filter((s) => s && toDate(s.start));
  const startMs = (toDate(peak.start) || { getTime: () => NaN }).getTime();
  let i = steps.findIndex((s) => toDate(s.start).getTime() === startMs);
  let span = "";
  if (i >= 0) {
    const first = steps[i];
    while (i + 1 < steps.length && maxLevel(steps[i + 1].levels) >= level) i += 1;
    const t0 = toDate(first.start);
    const t1 = toDate(steps[i].end) || new Date(toDate(steps[i].start).getTime() + 3 * 3600000);
    const today = dayKey(new Date(nowMs == null ? Date.now() : nowMs), tz);
    const pre = dayKey(t0, tz) > today ? "明日" : "";
    const crosses = dayKey(t1, tz) > dayKey(t0, tz) && fmtHour(t1, tz) !== "00";
    span = crosses ? ` ${pre}${fmtHour(t0, tz)}時–翌${fmtHour(t1, tz)}時` : ` ${pre}${fmtHour(t0, tz)}–${endHour(t1, tz)}時`;
  }
  return `見通し ${phen.join("・") || "–"}(${OUTLOOK_WORD[level] || `L${level}`})${span}`;
}

/** キキクル: the legend's words and colours (legend_jp_normal_{inund,land}.svg, legend_jp_flood_risk.svg). */
const KIKIKURU_WORDS = ["", "今後の情報等に留意", "注意", "警戒", "危険", "災害切迫"];
const KIKIKURU_ELEMENTS = [["inund", "浸水"], ["land", "土砂"], ["flood", "洪水"]];

function kikikuruWord(level) {
  const l = num(level);
  return l == null ? "" : KIKIKURU_WORDS[Math.max(0, Math.min(5, Math.round(l)))] || "";
}

/** [background, text] for a キキクル level; level 1 is white (浸水/土砂) or cyan (洪水). */
function kikikuruColour(level, element) {
  const l = num(level);
  if (l === 1) return [element === "flood" ? "#3CFFFF" : "#FFFFFF", "#1a1a1a"];
  return LEVEL_COLOURS[l] || ["var(--jc-surface)", "var(--jc-ink)"];
}

/** 「キキクル(the ward) 浸水 0 · 土砂 2 注意 · 洪水 –」 as parts [{element, ja, level, word, text}]. */
function kikikuruParts(attrs) {
  if (!attrs) return [];
  return KIKIKURU_ELEMENTS.map(([k, ja]) => {
    const level = num(attrs[k]);
    const word = level != null && level >= 1 ? kikikuruWord(level) : "";
    return { element: k, ja, level, word, text: `${ja} ${level == null ? "–" : level}${word ? ` ${word}` : ""}` };
  });
}

/** Compact pill for キキクル ≥ 2: {text, level, colours} or null. */
function kikikuruPill(st) {
  const a = liveAttrs(st);
  const state = st ? num(st.state) : null;
  if (!a || state == null || state < 2) return null;
  const parts = kikikuruParts(a);
  const top = Math.max(state, ...parts.map((p) => p.level || 0));
  const at = parts.filter((p) => p.level === top);
  const element = at.length === 1 ? at[0].element : "land";
  return { text: `キキクル ${at.map((p) => p.ja).join("・") || ""} ${kikikuruWord(top)}`.replace(/\s+/g, " ").trim(),
    level: top, colours: kikikuruColour(top, element) };
}

/** 降水短時間予報 (rasrf) at home: {title, sub} for the full page's 15-h strip. */
function rainOutlookText(attrs, tz, nowMs, wetNow) {
  const s = attrs && Array.isArray(attrs.series) ? attrs.series.filter((p) => p && toDate(p.time)) : [];
  if (!s.length) return { title: "No 15-hour forecast frames", sub: "" };
  const peak = Math.max(0, ...s.map((p) => num(p.band) || 0));
  const first = toDate(attrs.first_rain);
  if (first) {
    const upto = peak >= 8 ? "80+" : String([0, 1, 5, 10, 20, 30, 50, 80, 80][peak]);
    const now = nowMs == null ? Date.now() : nowMs;
    // the next-hour block already says it is raining: this block must not read as "dry until then"
    if (wetNow && first.getTime() - now <= 2 * 3600000) return { title: "Rain goes on", sub: `up to ${upto} mm/h` };
    const tomorrow = dayKey(first, tz) > dayKey(new Date(now), tz);
    return { title: `Rain from ~${tomorrow ? "tomorrow " : ""}${fmtTime(first, tz)}`, sub: `up to ${upto} mm/h` };
  }
  return { title: "Dry for the next 15 h", sub: peak === 1 ? "under 1 mm/h at times" : "" };
}

/** Compact: the next-hour sub-line's " · rain from ~HH:MM" while the next hour is dry. */
function rainFromSuffix(nextAttrs, outlookAttrs, tz, nowMs) {
  if (!nextAttrs || !outlookAttrs || nextAttrs.raining_now || nextAttrs.minutes_to_rain != null) return "";
  const first = toDate(outlookAttrs.first_rain);
  const now = nowMs == null ? Date.now() : nowMs;
  if (!first || first.getTime() <= now) return "";
  const tomorrow = dayKey(first, tz) > dayKey(new Date(now), tz);
  return ` · rain from ~${tomorrow ? "tomorrow " : ""}${fmtTime(first, tz)}`;
}

// ---- radar layers (full page)
/** Chips in order. keys = entries of the radar_frames sensor's `layers` attribute. */
const LAYER_DEFS = [
  { id: "rain", ja: "雨", en: "Rain radar · last and next 60 min" },
  { id: "rasrf", ja: "雨15h", en: "降水短時間予報 · 1-h rain, next 15 h", keys: ["rasrf"] },
  { id: "thunder", ja: "雷", en: "雷活動度 + 竜巻発生確度 · next 60 min · 落雷 strikes", keys: ["thns", "trns"] },
  { id: "risk", ja: "キキクル", en: "キキクル 危険度分布 · last hour", keys: ["risk_inund", "risk_land", "risk_flood"] },
  { id: "flood", ja: "浸水想定", en: "洪水浸水想定区域 (想定最大規模) · GSI", keys: ["flood_hazard"] },
  // Himawari tiles stop at z6 (~2 km a pixel): at Near (15 km across) the whole view would be about
  // 7 satellite pixels, so the layer needs a view of at least 50 km (the Area preset and wider).
  { id: "sat", ja: "衛星", en: "ひまわり 赤外 (B13)", keys: ["himawari_ir"], minSpanKm: 50 },
];
const RISK_SUBS = [
  { id: "inund", ja: "浸水", key: "risk_inund" },
  { id: "land", ja: "土砂", key: "risk_land" },
  { id: "flood", ja: "洪水", key: "risk_flood" },
];

/** Fill every placeholder of a tile template (member defaults to "none", as JMA's own map does). */
function fillTemplate(template, frame, z, x, y) {
  const f = frame || {};
  return String(template).replaceAll("{basetime}", f.basetime || "").replaceAll("{member}", f.member || "none")
    .replaceAll("{validtime}", f.validtime || "").replaceAll("{z}", z).replaceAll("{x}", x).replaceAll("{y}", y);
}

/**
 * キキクル frames rename as newer ones arrive (seen 2026-09-28: the 15:30 frame was immed0 at 15:44
 * and immed2 at 16:05; its immed0 URL then answered 404). A tile that fails under immedN is tried
 * under the next name: immed0 -> immed1 -> immed2 -> none. null = nothing left to try.
 */
function nextMember(member) {
  const m = /^immed([0-2])$/.exec(member || "");
  if (!m) return null;
  return +m[1] < 2 ? `immed${+m[1] + 1}` : "none";
}

function layerUsable(layers, key) {
  const l = layers && layers[key];
  return !!(l && typeof l.template === "string" && (l.static || (Array.isArray(l.frames) && l.frames.length)));
}

/** Layer ids the frames sensor can serve now (雨 needs the nowcast; 雷 needs thns; キキクル any one of three). */
function availableLayers(attrs) {
  if (!attrs) return [];
  const out = [];
  if (attrs.tile_template && attrs.basetime) out.push("rain");
  const L = attrs.layers && typeof attrs.layers === "object" ? attrs.layers : {};
  for (const d of LAYER_DEFS) {
    if (!d.keys) continue;
    if (d.id === "thunder" ? layerUsable(L, "thns") : d.keys.some((k) => layerUsable(L, k))) out.push(d.id);
  }
  return out;
}

/** JMA's jmatile layers (nowcast, 降水短時間予報, キキクル) hold data at even zooms only. */
function evenOnly(template) {
  return /^https:\/\/www\.jma\.go\.jp\/bosai\/jmatile\//.test(String(template || ""));
}

/**
 * Data zoom for one tile source: the view zoom rounded, clamped to the source's zmin..zmax. A
 * source that is even-only (JMA's own map config: zoomUse="even") takes the even zoom at or below
 * that, never under 4: an odd zoom answers 200 with a blank tile, so the layer would just be empty.
 */
function layerZoom(viewZ, src) {
  const zmax = src && num(src.zmax) != null ? num(src.zmax) : RADAR_MAX_Z;
  const zmin = src && num(src.zmin) != null ? num(src.zmin) : 0;
  const z = Math.max(zmin, Math.min(Math.round(viewZ), zmax));
  if (!src || !(src.even || evenOnly(src.template))) return z;
  return Math.max(4, z - (z % 2));
}

/** The zoom preset a layer may use: a layer with minSpanKm moves up to the first preset that wide. */
function layerZoomIdx(layerId, zoomIdx, spans) {
  const d = LAYER_DEFS.find((l) => l.id === layerId);
  const sp = spans || [];
  if (!d || !d.minSpanKm || !sp.length || (sp[zoomIdx] || 0) >= d.minSpanKm) return zoomIdx;
  const ok = sp.findIndex((km) => km >= d.minSpanKm);
  return ok >= 0 ? ok : sp.length - 1;
}

/**
 * Frames of one layer: {srcs:[{key, template, zmin, zmax, attribution}], items:[{kind, basetime,
 * member, validtime, parts:[{src, frame}]}], base, static, hours}. Kinds: newest observed frame =
 * "now", older "past", validtime after it "forecast" (rasrf: all forecast). 雷 = thns with the trns
 * frame of the same time drawn on top.
 */
function layerTimeline(layerId, sub, attrs) {
  const none = { srcs: [], items: [], base: null, static: false, hours: false };
  if (!attrs) return none;
  if (layerId === "rain") {
    if (!attrs.tile_template) return none;
    return {
      srcs: [{ key: "hrpns", template: attrs.tile_template, zmin: 0, zmax: RADAR_MAX_Z }],
      items: frameList(attrs).map((f) => ({ ...f, parts: [{ src: 0, frame: f }] })),
      base: attrs.basetime, static: false, hours: false,
    };
  }
  const L = attrs.layers && typeof attrs.layers === "object" ? attrs.layers : {};
  let keys;
  if (layerId === "risk") keys = [(RISK_SUBS.find((r) => r.id === sub) || RISK_SUBS[0]).key];
  else keys = ((LAYER_DEFS.find((d) => d.id === layerId) || {}).keys || []);
  keys = keys.filter((k) => layerUsable(L, k));
  if (!keys.length || (layerId === "thunder" && keys[0] !== "thns")) return none;
  const srcs = keys.map((k) => ({ key: k, template: L[k].template, zmin: num(L[k].zmin) ?? 0,
    zmax: num(L[k].zmax) ?? RADAR_MAX_Z, attribution: L[k].attribution || "" }));
  if (L[keys[0]].static) {
    return { srcs: [srcs[0]], items: [{ kind: "static", basetime: "", validtime: "", parts: [{ src: 0, frame: {} }] }],
      base: null, static: true, hours: false };
  }
  const ok = (f) => f && typeof f.basetime === "string" && typeof f.validtime === "string";
  const main = L[keys[0]].frames.filter(ok);
  const observed = main.filter((f) => f.basetime === f.validtime);
  const base = observed.length ? observed[observed.length - 1].validtime
    : main.reduce((m, f) => (f.basetime > m ? f.basetime : m), "");
  const items = main.map((f) => {
    const parts = [{ src: 0, frame: f }];
    for (let j = 1; j < keys.length; j++) {
      const m = (L[keys[j]].frames || []).filter(ok).find((g) => g.validtime === f.validtime && g.basetime === f.basetime);
      if (m) parts.push({ src: j, frame: m });
    }
    const kind = f.validtime > base ? "forecast" : f.validtime === base ? "now" : "past";
    return { kind, basetime: f.basetime, member: f.member, validtime: f.validtime, parts };
  });
  return { srcs, items, base, static: false, hours: layerId === "rasrf" };
}

/** Stamp for a layer frame: rasrf in hours ("08:00 · 1 h rain +8 h"), static none, else frameLabel. */
function layerStamp(item, tl, tz, nowMs) {
  if (!item || !tl || tl.static) return "";
  if (!tl.hours) return frameLabel(item, tl.base, tz, nowMs);
  const t = parseJmaTime(item.validtime);
  const b = parseJmaTime(tl.base);
  if (!t || !b) return "";
  const today = dayKey(new Date(nowMs == null ? Date.now() : nowMs), tz);
  const pre = dayKey(t, tz) > today ? "tomorrow " : "";
  return `${pre}${fmtTime(t, tz)} · 1 h rain +${Math.round((t - b) / 3600000)} h`;
}

// ---- typhoon
const TY_CATEGORY = { TY: "typhoon", STS: "severe tropical storm", TS: "tropical storm", TD: "tropical depression",
  LOW: "extratropical low" };
const TY_PILL_KM = 500;

/** JMA's typhoon number "2626" (YYNN) -> "台風26号"; null when absent. */
function typhoonNumber(storm) {
  const m = /^\d{2}(\d{2})$/.exec(String((storm && storm.number) || ""));
  return m ? `台風${+m[1]}号` : null;
}

/** "10/1 21時" in the zone (Japanese month/day order). */
function mdHourJa(date, tz) {
  const parts = dtf("en-GB", { timeZone: tz || FALLBACK_TZ, month: "numeric", day: "numeric" })
    .formatToParts(date);
  const get = (type) => (parts.find((p) => p.type === type) || { value: "" }).value;
  return `${+get("month")}/${+get("day")} ${+fmtHour(date, tz)}時`;
}


/** "Thu 1 Oct 21:00" in the zone (fixed month names: ICU's en-GB writes "Sept"). */
function dayTimeEn(date, tz) {
  const parts = dtf("en-GB", { timeZone: tz || FALLBACK_TZ, weekday: "short", day: "numeric", month: "numeric" })
    .formatToParts(date);
  const get = (type) => (parts.find((q) => q.type === type) || { value: "" }).value;
  // pass 4: Japanese first, "6日(火) 22:11" (full page only; the compact line has its own English helper)
  const ja = dtf("ja-JP", { timeZone: tz || FALLBACK_TZ, weekday: "short" }).format(date);
  return `${+get("day")}日(${ja}) ${fmtTime(date, tz)}`;
}

/** "2626" (YYNN) -> "Typhoon 26"; a storm with no number -> "Tropical depression". */
function typhoonNumberEn(storm) {
  const m = /^\d{2}(\d{2})$/.exec(String((storm && storm.number) || ""));
  return m ? `Typhoon ${+m[1]}` : "Tropical depression";
}

/** "12:00 on 1 Oct" in the zone (the month in the language of hass.locale; "Sept" is written "Sep"). */
function timeOnDayEn(date, tz) {
  return `${fmtTime(date, tz)} on ${fmtDay(date, tz).md}`;
}

const kmText = (km) => `${new Intl.NumberFormat(LOCALE).format(Math.round(km))} km`;
/** A no-break space between a figure and its unit, so "382 km" never wraps with "km" alone on a line. */
const nbUnit = (s) => (s == null ? s : String(s).replace(/(\d) (km\/h|km|hPa|m\/s|mm|min|h)(?![\w/])/g, "$1\u00a0$2"));

/** The compact typhoon line's pieces {name, km, when}, only when the closest approach is ≤ 500 km. */
function typhoonParts(storm, tz) {
  const c = storm && storm.closest;
  const km = c ? num(c.distance_km) : null;
  const t = c ? toDate(c.time) : null;
  if (km == null || km > TY_PILL_KM) return null;
  // 0.4.0 backend: the nearest point of the track LINE (between two forecast centres) says 頃; no time = the name and distance alone
  return { name: typhoonNumber(storm) || storm.name_ja || "台風", km, when: t ? `${mdHourJa(t, tz)}${c.interpolated ? "頃" : ""}` : "" };
}

/** The compact typhoon line in English {name, km, when}, only when the closest approach is <= 500 km:
 *  "Typhoon 26" · "closest 241 km" · "around 12:00 on 1 Oct" ("around" while the time is interpolated along the track, else "at"). */
function typhoonPartsEn(storm, tz) {
  const c = storm && storm.closest;
  const km = c ? num(c.distance_km) : null;
  const t = c ? toDate(c.time) : null;
  if (km == null || km > TY_PILL_KM) return null;
  return { name: typhoonNumberEn(storm), km, when: t ? `${c.interpolated ? "around" : "at"} ${timeOnDayEn(t, tz)}` : "" };
}

/** 「台風26号 最接近 382 km 10/1 21時」 only when the closest approach is ≤ 500 km. */
function typhoonPill(storm, tz) {
  const p = typhoonParts(storm, tz);
  return p ? `${p.name} 最接近 ${kmText(p.km)}${p.when ? ` ${p.when}` : ""}` : null;
}

/** Full-page lines for one storm: {title, sub, now, closest}. */
function typhoonLines(storm, tz) {
  if (!storm) return null;
  const n = storm.now || {};
  const name = [storm.name_ja, storm.name_en ? `(${storm.name_en})` : ""].filter(Boolean).join(" ");
  const cat = storm.category ? `${storm.category}${TY_CATEGORY[storm.category] ? ` · ${TY_CATEGORY[storm.category]}` : ""}` : "";
  const nowBits = [];
  if (num(storm.distance_km) != null) nowBits.push(`${kmText(storm.distance_km)} away`);
  if (num(n.pressure_hpa) != null) nowBits.push(`${num(n.pressure_hpa)} hPa`);
  if (num(n.max_wind_ms) != null) nowBits.push(`max wind ${num(n.max_wind_ms)} m/s`);
  const c = storm.closest;
  const ct = c && toDate(c.time);
  return {
    title: [typhoonNumber(storm), name].filter(Boolean).join(" "),
    sub: cat,
    now: nowBits.length ? `Now ${nowBits.join(" · ")}` : "",
    closest: c && num(c.distance_km) != null && ct
      ? (c.interpolated
        ? `Track passes ${kmText(c.distance_km)} from home · about ${dayTimeEn(ct, tz)}`
          + `${num(c.circle_km) != null ? ` · forecast circle ${kmText(c.circle_km)}` : ""}`
        : `Closest ${kmText(c.distance_km)} · ${dayTimeEn(ct, tz)}`)
      : "",
  };
}

/** Pixel position of lat/lon in a w×h view centred on (cLat, cLon) at zoom z. */
function projectPoint(lat, lon, cLat, cLon, z, w, h) {
  const [px, py] = worldPx(lat, lon, z);
  const [cx, cy] = worldPx(cLat, cLon, z);
  return [px - cx + w / 2, py - cy + h / 2];
}

/** A distance on the ground in view pixels at latitude lat, zoom z (Web Mercator). */
function kmToPx(km, lat, z) {
  return (km * 1000) / ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z);
}

/**
 * Overlay geometry for one storm: {past:[[x,y]], track:[[x,y]] (now first), circles:[{x,y,r}],
 * now:[x,y]|null, labels:[{x,y,text}]} — labels ("29日1時") at the forecast centres, in the zone.
 */
function typhoonGeometry(storm, cLat, cLon, z, w, h, tz) {
  const P = (lat, lon) => projectPoint(lat, lon, cLat, cLon, z, w, h);
  const okLL = (lat, lon) => num(lat) != null && num(lon) != null;
  const n = storm && storm.now;
  const now = n && okLL(n.lat, n.lon) ? P(+n.lat, +n.lon) : null;
  const past = ((storm && storm.past_track) || []).filter((p) => Array.isArray(p) && okLL(p[0], p[1])).map((p) => P(+p[0], +p[1]));
  const pts = ((storm && storm.track) || []).filter((p) => p && okLL(p.lat, p.lon));
  const track = (now ? [now] : []).concat(pts.map((p) => P(+p.lat, +p.lon)));
  const circles = pts.filter((p) => num(p.circle_km) != null && +p.circle_km > 0).map((p) => {
    const [x, y] = P(+p.lat, +p.lon);
    return { x, y, r: kmToPx(+p.circle_km, +p.lat, z) };
  });
  const labels = pts.filter((p) => toDate(p.time) && num(p.circle_km) != null).map((p) => {
    const t = toDate(p.time);
    const day = dtf("en-GB", { timeZone: tz || FALLBACK_TZ, day: "numeric" }).format(t);
    const [x, y] = P(+p.lat, +p.lon);
    return { x, y, text: `${+day}日${+fmtHour(t, tz)}時` };
  });
  return { past, track, circles, now, labels };
}

// ---- WBGT (環境省 暑さ指数)
/** 環境省's bands: <21 ほぼ安全 · 21–25 注意 · 25–28 警戒 · 28–31 厳重警戒 · ≥31 危険. tone only from 28. */
function wbgtBand(value) {
  const v = num(value);
  if (v == null) return null;
  if (v >= 31) return { word: "危険", level: 4, tone: "danger" };
  if (v >= 28) return { word: "厳重警戒", level: 3, tone: "hot" };
  if (v >= 25) return { word: "警戒", level: 2, tone: null };
  if (v >= 21) return { word: "注意", level: 1, tone: null };
  return { word: "ほぼ安全", level: 0, tone: null };
}

// ---- Japan view and lightning
const TY_MIN_SPAN_KM = 200;      // typhoon track: drawn from the Region preset up
const JAPAN_MIN_SPAN_KM = 1000;  // city marks: drawn from this span up
const LIDEN_KEEP = 24;           // fetched strike files kept in memory
const LIDEN_TIMEOUT_MS = 8000;   // a strike file that has not answered by then has failed
const LIDEN_RETRY_MS = 60000;    // a failed strike file is asked for again after this long
// Marks are placed in this order; a mark that would cover one already placed is left out.
const CITY_ORDER = ["東京", "大阪", "札幌", "福岡", "那覇", "仙台", "名古屋", "新潟", "広島", "鹿児島", "金沢", "高知", "釧路", "石垣"];

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * View zoom for a preset: the span across the WIDTH, except from the Japan preset up, where the
 * country (about 0.9 x the span, north to south) must also fit the map's height.
 */
function fitZoom(w, h, spanKm, lat) {
  const z = spanZoom(w, spanKm, lat);
  return spanKm >= JAPAN_MIN_SPAN_KM && h > 0 ? Math.min(z, spanZoom(h, spanKm * 0.9, lat)) : z;
}

/** Initial bearing from point 1 to point 2, degrees 0..360. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/**
 * The date ("YYYY-MM-DD") the nationwide marks and table show: today until 17:00, when JMA's
 * evening issue drops today's high; then tomorrow. null when no city carries either.
 */
function japanDay(cities, nowMs) {
  const now = new Date(nowMs == null ? Date.now() : nowMs);
  const today = dayKey(now, JST);
  const dates = new Set();
  for (const c of cities || []) for (const d of (c && c.days) || []) if (d && d.date && d.code) dates.add(d.date);
  const later = [...dates].filter((d) => d > today).sort();
  if (dates.has(today) && +fmtHour(now, JST) < 17) return today;
  return later[0] || (dates.has(today) ? today : null);
}

/** The nationwide day buttons: "今日 9月30日" · "明日 10月1日" · "金 10月2日" (dates are JST days, Japanese-first). */
function japanDayLabel(date, todayKey) {
  const t = toDate(`${date}T12:00:00+09:00`);
  if (!t) return String(date || "");
  const d = fmtDay(t, JST);
  const t0 = toDate(`${todayKey}T12:00:00+09:00`);
  const next = t0 ? dayKey(new Date(t0.getTime() + 86400000), JST) : "";
  return `${date === todayKey ? "今日" : date === next ? "明日" : d.ja} ${d.jmd}`;
}

/** A city's entry for one date, or null. */
function cityDay(city, date) {
  return ((city && city.days) || []).find((d) => d && d.date === date) || null;
}

/**
 * City marks for the map: [{x, y, name, name_en, icon, temp, pop}] in a w×h view centred on
 * (cLat, cLon) at zoom z. A city within skipKm of the centre is left to the card's own header;
 * a mark that would overlap one already placed (box bw×bh) or leave the view is dropped.
 */
function cityMarks(cities, date, cLat, cLon, z, w, h, opts) {
  const o = { bw: 44, bh: 42, skipKm: 40, ...(opts || {}) };
  const rank = (c) => { const i = CITY_ORDER.indexOf(c.name); return i < 0 ? CITY_ORDER.length : i; };
  const list = (cities || []).filter((c) => c && num(c.lat) != null && num(c.lon) != null && cityDay(c, date))
    .map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
  const placed = [];
  for (const { c } of list) {
    if (haversineKm(cLat, cLon, +c.lat, +c.lon) < o.skipKm) continue;
    const [x, y] = projectPoint(+c.lat, +c.lon, cLat, cLon, z, w, h);
    if (x < o.bw / 2 || y < o.bh / 2 || x > w - o.bw / 2 || y > h - o.bh / 2) continue;
    if (placed.some((p) => Math.abs(p.x - x) < o.bw && Math.abs(p.y - y) < o.bh)) continue;
    const d = cityDay(c, date);
    placed.push({ x, y, name: c.name, name_en: c.name_en || "", icon: d.icon || "", code: d.code,
      temp: num(d.temp_max) != null ? num(d.temp_max) : num(d.temp_min), pop: num(d.pop) });
  }
  return placed;
}

/** URL of one LIDEN strike file; "" unless the template is JMA's and has no tile placeholders left. */
function lidenUrl(layer, frame) {
  if (!layer || typeof layer.template !== "string" || !frame) return "";
  const url = fillTemplate(layer.template, frame, "", "", "");
  return JMA_URL_RE.test(url) && !/[{}]/.test(url) ? url : "";
}

/**
 * The strike files that belong to a map frame: the 5-minute files with a time in
 * (frame − windowMin, frame]. A forecast frame has none (nothing has struck yet).
 */
function lidenFramesFor(item, lidenFrames, windowMin) {
  if (!item || item.kind === "forecast" || item.kind === "static") return [];
  const end = parseJmaTime(item.validtime);
  if (!end) return [];
  const from = end.getTime() - (windowMin || 10) * 60000;
  return (lidenFrames || []).filter((f) => {
    const t = f && parseJmaTime(f.validtime);
    return !!t && t.getTime() > from && t.getTime() <= end.getTime();
  });
}

/** Strikes of one LIDEN GeoJSON file: [{lat, lon, cg, t}] (t = ms, from obstimeJST; cg = cloud-to-ground). */
function lidenPoints(geojson) {
  const out = [];
  for (const f of (geojson && Array.isArray(geojson.features) ? geojson.features : [])) {
    const c = f && f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates : null;
    if (!Array.isArray(c) || num(c[0]) == null || num(c[1]) == null) continue;
    const p = f.properties || {};
    const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(p.obstimeJST || ""));
    const t = m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`) : NaN;
    out.push({ lat: +c[1], lon: +c[0], cg: +p.type === 4, t: Number.isNaN(t) ? null : t });
  }
  return out;
}

/** Blitzortung strikes in HA: geo_location entities of `source`, as [{lat, lon, cg: null, t}]. */
function blitzStrikes(states, source) {
  const out = [];
  for (const id of Object.keys(states || {})) {
    if (!id.startsWith("geo_location.")) continue;
    const a = states[id] && states[id].attributes;
    if (!a || a.source !== source || num(a.latitude) == null || num(a.longitude) == null) continue;
    const t = toDate(a.publication_date);
    out.push({ lat: +a.latitude, lon: +a.longitude, cg: null, t: t ? t.getTime() : null });
  }
  return out;
}

/** Strikes with a time in (fromMs, toMs]; one without a time is kept only when keepUntimed. */
function strikesBetween(points, fromMs, toMs, keepUntimed) {
  return (points || []).filter((p) => (p.t == null ? !!keepUntimed : p.t > fromMs && p.t <= toMs));
}

/** {count, ground, nearestKm, bearing} of strikes as seen from home; null for none. */
function strikeSummary(points, home) {
  if (!points || !points.length || !home) return null;
  let best = null;
  for (const p of points) {
    const km = haversineKm(home[0], home[1], p.lat, p.lon);
    if (!best || km < best.km) best = { km, p };
  }
  return { count: points.length, ground: points.filter((p) => p.cg === true).length,
    nearestKm: best.km, bearing: bearingDeg(home[0], home[1], best.p.lat, best.p.lon) };
}

/** "落雷 12 · nearest 38 km SW" for the line under the map; "" for none. */
function strikeLine(summary, minutes) {
  if (!summary) return "";
  return `落雷 ${summary.count} in ${minutes} min · nearest ${kmText(summary.nearestKm)} ${compass(summary.bearing)}`;
}

/** Compact pill for a strike near home: {text, near} or null (no reading, or farther than maxKm). */
function lightningPill(distSt, azSt, maxKm) {
  const km = liveAttrs(distSt) ? num(distSt.state) : null;
  if (km == null || km > (maxKm == null ? 50 : maxKm)) return null;
  const az = liveAttrs(azSt) ? num(azSt.state) : null;
  return { text: `落雷 ${kmText(km)}${az == null ? "" : ` ${compass(az)}`}`, near: km <= 10 };
}

/** The same pill from the strikes themselves: the NEAREST of `strikes` as seen from home ({text, near}, or null beyond maxKm). */
function nearestStrikePill(strikes, home, maxKm) {
  const sum = strikeSummary(strikes, home);
  if (!sum || sum.nearestKm > (maxKm == null ? 50 : maxKm)) return null;
  return { text: `落雷 ${kmText(sum.nearestKm)} ${compass(sum.bearing)}`, near: sum.nearestKm <= 10 };
}

// ---- the top block
const TY_NEAR_KM = 300;   // the typhoon line's dot turns amber at this closest approach or less
/** Feeds of the feed_problem binary sensor, as the feed-problem line names them. */
const FEED_NAMES = { warnings: "警報", amedas: "AMeDAS", amedas_station: "AMeDAS station", hourly: "hourly forecast",
  nowcast: "nowcast", quake: "quake" };

/**
 * The temperature unit the weather entity shows: its `temperature_unit` attribute (°C, °F or K), else °C. Home Assistant
 * converts the entity's own temperature and apparent_temperature (and the forecast rows' temperature / templow) to that
 * unit, but not ha-jma's extra attributes (temp_max, temp_min, the observed and normal values, the ranges, the nationwide
 * table): those are degrees Celsius, so they go through toUnit() before they are drawn beside the converted ones.
 */
function tempUnit(a) {
  const u = a && a.temperature_unit;
  return u === "°F" || u === "K" ? u : "°C";
}

/** A Celsius value in `unit` (null stays null). */
function toUnit(celsius, unit) {
  const c = num(celsius);
  if (c == null) return null;
  return unit === "°F" ? (c * 9) / 5 + 32 : unit === "K" ? c + 273.15 : c;
}

/**
 * Rows A and B from the weather entity: {ok, temp, unit, ja, en, title, hi, lo, feels, icon}. The name is
 * JMA's forecast for today, which the row's title says; a missing high or low reads "—", and a gone entity
 * "—" / "Couldn't reach JMA weather". The figures are in the entity's temperature unit (see tempUnit).
 * whole: true on the compact card (a glance surface) shows the temperature in whole degrees ("30"); the
 * full page (default) keeps one decimal ("29.6"). Never "-0" or "-0.0".
 */
function nowBlock(st, whole) {
  if (!st || st.state === "unavailable" || st.state === "unknown") {
    return { ok: false, temp: "—", unit: "°C", ja: "Couldn't reach JMA weather", en: "", title: "", hi: "—", lo: "—", feels: "", icon: null };
  }
  const a = st.attributes || {};
  const unit = tempUnit(a);
  const en = prettyEn(a.jma_name_en);
  const deg = (v) => (num(v) == null ? "—" : `${Math.round(num(v))}°`);
  // Math.round(-0.4) is -0 and String(-0) is "0"; toFixed(1) of -0.04 is "-0.0", so that one is mapped by hand
  const big = (v) => {
    if (num(v) == null) return "—";
    if (whole) return String(Math.round(num(v)));
    const s = num(v).toFixed(1);
    return s === "-0.0" ? "0.0" : s;
  };
  return {
    ok: true,
    temp: big(a.temperature),
    unit,
    ja: a.jma_name_ja || "",
    en: en || conditionWords(st.state),
    title: a.jma_name_ja || en ? "JMA forecast for today" : "",
    // the forecast high / low, else (every evening after JMA's 17:00 report drops them) the day's measured ones
    hi: deg(toUnit(num(a.temp_max) != null ? a.temp_max : a.temp_max_observed, unit)),
    lo: deg(toUnit(num(a.temp_min) != null ? a.temp_min : a.temp_min_observed, unit)),
    feels: num(a.apparent_temperature) == null ? "" : `Feels ${Math.round(num(a.apparent_temperature))}°`,
    icon: a.jma_icon || null,
  };
}

/** A chip keeps JMA's level colour; on JMA red its text is ink (white measures 3.8:1 there, ink 4.6:1). */
function chipColours(colours) {
  const [bg, fg] = colours || ["var(--jc-surface-2)", "var(--jc-ink)"];
  return { bg, fg: bg === "#FF2800" ? "#1a1a1a" : fg };
}

/** a warning chip of level 2-5 takes the theme's tone from its class (lv2 needs you, lv3-5 alarm); other chips keep the colours they were given. */
function chipTone(node, level, bg, fg) {
  const l = Math.round(num(level) || 0);
  if (l >= 2) { node.classList.add(`lv${Math.min(5, l)}`); return; }
  node.style.background = bg;
  node.style.color = fg;
}

const TSUNAMI_GRADES = {
  watch: { kind: "tsunamiwatch", en: "Tsunami advisory", ja: "津波注意報" },
  warning: { kind: "tsunami", en: "Tsunami warning", ja: "津波警報" },
  major_warning: { kind: "tsunami", en: "Major tsunami warning", ja: "大津波警報" },
};

const ZONED_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
/** HH:MM when the instant is on today's date (o.now) in the card's zone, else "HH:MM on D Mon" (the typhoon line's form). */
function whenText(ms, now, tz) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const n = num(now) == null ? Date.now() : +now;
  return dayKey(d, tz) === dayKey(new Date(n), tz) ? fmtTime(d, tz) : timeOnDayEn(d, tz);
}
const nonEmptyStr = (v) => typeof v === "string" && v.length > 0;

/** "up to N m" detail of a tsunami height: JMA's own words first (超 / 巨大 / 高い), else the number (one decimal at most). */
function tsunamiHeight(a) {
  const raw = typeof a.home_height === "string" ? a.home_height.trim() : "";
  const m = typeof a.home_height_m === "number" && Number.isFinite(a.home_height_m) && Math.round(a.home_height_m * 10) > 0
    ? String(Math.round(a.home_height_m * 10) / 10) : "";
  if (raw.includes("超")) return m ? `over ${m} m` : "";
  if (raw === "巨大") return "huge";
  if (raw === "高い") return "high";
  return m ? `up to ${m} m` : "";
}

/**
 * The tsunami line(s) from the tsunami sensor (0 or 1 notice); tz and now (ms) format the bulletin time of the elsewhere line
 * (HH:MM today, else with its day). The area is the sensor's own `home_area` attribute: JMA's tsunami forecast area of the
 * place (東京湾内湾 for Chiyoda); a place with no such area (an inland prefecture) gets the grade alone.
 */
function tsunamiNotices(t, tz, now) {
  const a = liveAttrs(t);
  if (!a) return [];
  const area = typeof a.home_area === "string" ? a.home_area.trim() : "";
  const nb = (s) => s.replace(/ /g, NBSP);
  if (Object.prototype.hasOwnProperty.call(TSUNAMI_GRADES, t.state)) {
    const g = TSUNAMI_GRADES[t.state];
    return [{ kind: g.kind, mark: "accent", parts: [{ text: g.en, strong: true }, ...(area ? [{ text: "·" + NBSP + nb(area) }] : [])],
      detail: tsunamiHeight(a), title: area ? `${g.ja} ${area}` : g.ja }];
  }
  if (t.state !== "none" || (a.max_grade !== "warning" && a.max_grade !== "major_warning")) return [];
  const c = a.counts && typeof a.counts === "object" ? a.counts : {};
  const n = (num(c.major_warning) || 0) + (num(c.warning) || 0);
  const known = num(c.major_warning) != null || num(c.warning) != null;
  const names = [...(Array.isArray(a.areas_major) ? a.areas_major : []), ...(Array.isArray(a.areas_warning) ? a.areas_warning : [])];
  const issued = typeof a.issued === "string" && ZONED_RE.test(a.issued.trim()) ? whenText(Date.parse(a.issued), now, tz) : "";
  return [{ kind: "tsunamijp", mark: "muted",
    detail: [known && n >= 1 ? (n === 1 ? "1 area" : `${n} areas`) : "", issued].filter(Boolean).join(" · "),
    parts: [{ text: a.max_grade === "major_warning" ? "Major tsunami warning in Japan" : "Tsunami warning in Japan", strong: true },
      ...(area ? [{ text: "·" + NBSP + "not" + NBSP + nb(area), muted: true }] : [])],
    title: names.join("・") }];
}

/** The heat stroke alert line(s) from the heat-alert sensor: today, and tomorrow when it is higher (special) or today has none. */
function heatNotices(h) {
  if (!h || h.state === "unavailable") return [];
  const a = h.attributes || {};
  const today = h.state === "alert" || h.state === "special";
  const tomorrow = a.tomorrow === "alert" || a.tomorrow === "special" ? a.tomorrow : "";
  // wbgt_max is a forecast FOR wbgt_date: it is shown only on the line of that day
  const wbgt = (target) => (num(a.wbgt_max) != null && nonEmptyStr(a.wbgt_date) && nonEmptyStr(target) && a.wbgt_date === target ? `WBGT ${num(a.wbgt_max)}` : "");
  const line = (grade, day) => ({ kind: day === "today" ? (grade === "special" ? "heatspecial" : "heat") : "heattomorrow",
    mark: day === "today" ? "accent" : "muted",
    parts: [{ text: grade === "special" ? "Special heat stroke alert" : "Heat stroke alert", strong: true }, { text: `·\u00a0${day}` }],
    detail: wbgt(day === "today" ? a.target_today : a.target_tomorrow), title: grade === "special" ? "熱中症特別警戒アラート" : "熱中症警戒アラート" });
  const out = [];
  if (today) out.push(line(h.state, "today"));
  if (tomorrow && (!today || (h.state === "alert" && tomorrow === "special"))) out.push(line(tomorrow, "tomorrow"));
  return out;
}

const ADVICE_HAZARDS = { quake: "earthquake", warning: "weather warning", typhoon: "typhoon", tsunami: "tsunami", heat: "heat", eew: "earthquake" };

/**
 * "What to do": the advice of the last alert the optional `alert_entity` reports (never a test alert; a time without a zone is
 * not trusted). That entity's attributes: advice (text), time (ISO 8601 with a zone), test (false), hazard (quake | warning |
 * typhoon | tsunami | heat | eew), level (emergency | urgent | ...), guidance (tsunami_home | tsunami_advisory |
 * tsunami_elsewhere), message (EEW text).
 * Shown while at most 6 h old, or for as long as `own` (that hazard's own line is drawn: tsunami / heat). own also drops the
 * hazard word from the label. The alert's time goes in detail: HH:MM today, else with its day (tz, now).
 */
function adviceNotices(x, now, tz, own, hazard) {
  const a = liveAttrs(x);
  if (!a || (a.test !== undefined && a.test !== false) || typeof a.advice !== "string") return [];
  const text = a.advice.trim();
  if (["", "none", "null", "unknown", "unavailable"].includes(text.toLowerCase())) return [];
  if (typeof a.time !== "string" || !ZONED_RE.test(a.time.trim())) return [];
  const t = Date.parse(a.time);
  const n = num(now) == null ? Date.now() : +now;
  if (!Number.isFinite(t) || t - n > 5 * 60000 || (!own && n - t > 6 * 3600000)) return [];
  const hz = hazard === undefined ? a.hazard : hazard;
  const word = !own && typeof hz === "string" && Object.prototype.hasOwnProperty.call(ADVICE_HAZARDS, hz) ? ADVICE_HAZARDS[hz] : "";
  return [{ kind: "advice", mark: a.level === "emergency" || a.level === "urgent" ? "accent" : "muted",
    parts: [{ text: word ? `What to do (${word})` : "What to do", strong: true }, { text: `· ${a.advice}` }],
    detail: whenText(t, n, tz), title: String(x.state) }];
}

/** The line each `guidance` key of a tsunami advice was written for. */
const GUIDANCE_LINE = { tsunami_home: "tsunami", tsunami_advisory: "tsunamiwatch", tsunami_elsewhere: "tsunamijp" };

/**
 * The tsunami, heat and advice lines in order; the advice sits under its own hazard's line, else after both.
 * A tsunami advice belongs to ONE tsunami line by its guidance key: a different line drawn now hides it; no line drawn,
 * or no usable guidance (older data), falls back to "any tsunami line".
 */
function alertNotices(st, opt) {
  const ts = tsunamiNotices(st.tsunami, opt.tz, opt.now);
  const he = heatNotices(st.heat_alert);
  const la = liveAttrs(st.alert_latest);
  const want = la && typeof la.guidance === "string" && Object.prototype.hasOwnProperty.call(GUIDANCE_LINE, la.guidance) ? GUIDANCE_LINE[la.guidance] : "";
  // a tsunami guidance key marks a tsunami alert whatever `hazard` says (or lacks)
  const hz = want ? "tsunami" : la && typeof la.hazard === "string" ? la.hazard : "";
  const ownT = hz === "tsunami" && ts.length > 0 && (!want || ts[0].kind === want);
  const stale = hz === "tsunami" && ts.length > 0 && !ownT;  // the grade changed after the advice was written
  const ownH = hz === "heat" && he.length > 0;
  const ad = stale ? [] : adviceNotices(st.alert_latest, opt.now, opt.tz, ownT || ownH, hz);
  const eew = [];
  const issued = la && typeof la.time === "string" && ZONED_RE.test(la.time.trim()) ? Date.parse(la.time) : NaN;
  const age = (num(opt.now) == null ? Date.now() : +opt.now) - issued;
  if (la && la.hazard === "eew" && la.test === false && ["emergency", "urgent"].includes(la.level)
      && Number.isFinite(age) && age >= -30000 && age <= 120000 && typeof la.message === "string" && la.message.trim()) {
    eew.push({ kind: "eew", mark: "accent", detail: whenText(issued, opt.now, opt.tz),
      parts: [{ text: "Earthquake early warning", strong: true }, { text: `· ${la.message}` }], title: String(st.alert_latest.state) });
  }
  return [...eew, ...(ownT ? [...ts, ...ad, ...he] : [...ts, ...he, ...ad])];
}

/**
 * Rows C and D under the header: {chips, notices}.
 * chips (JMA level colours): the warnings, highest level first, then キキクル from level 2 (compact).
 * notices (a dot, then the words), in this order: tsunami (warning/advisory for the place's coast area, else a warning elsewhere in Japan) ·
 * heat stroke alert (today; tomorrow too when it is higher, or when today has none) · "What to do" (the alert entity's last advice;
 * directly after its own tsunami / heat line, else after both with the hazard in brackets) — these in compact and full — then
 * feed problem · 警報 unavailable · a typhoon within 500 km (compact; the full page has its own section) · a strike within 50 km (compact).
 * The advice shows while at most 6 h old, or for a tsunami / heat alert as long as its own line is drawn; never a test alert.
 * A tsunami advice belongs to one tsunami line by its `guidance` key (tsunami_home / _advisory / _elsewhere): another tsunami line
 * drawn now hides it. Times in the advice and in the elsewhere line show their day unless they are today (o.now, the card's zone).
 * s = states {warnings, feed, kikikuru, typhoon, lightning_distance, lightning_azimuth, tsunami, heat_alert, alert_latest};
 * o = {full, tz, warningsId, strikes, home, now (ms; default Date.now())}.
 * chip {text, title, bg, fg, level} · notice {kind, mark: "accent"|"muted", parts: [{text, strong, muted}], detail, title}
 */
function topBlock(s, o) {
  const st = s || {};
  const opt = o || {};
  const w = st.warnings;
  // an unavailable/unknown/missing warnings sensor must never read as "no warnings"
  const unav = !w || w.state === "unavailable" || w.state === "unknown"
    || w.attributes?.area_missing === true || !Array.isArray(w.attributes?.warnings);
  const level = (x) => num(x && x.level) || 0;
  const list = ((!unav && w.attributes && w.attributes.warnings) || []).slice().sort((a, b) => level(b) - level(a));
  const chips = list.map((x) => ({ ...pillText(x), ...chipColours(LEVEL_COLOURS[level(x)]), level: level(x) }));
  const notices = [];
  notices.push(...alertNotices(st, opt));
  if (st.tsunami && (!liveAttrs(st.tsunami)
      || !["none", "watch", "warning", "major_warning"].includes(st.tsunami?.state))) {
    notices.push({ kind: "tsunamiunav", mark: "muted", detail: "",
      parts: [{ text: "Couldn't reach the tsunami feed" }], title: "" });
  }
  if (st.quake?.attributes?.connected === false) {
    notices.push({ kind: "quakeunav", mark: "accent", detail: "",
      parts: [{ text: "Earthquake feed reconnecting · last readings retained" }], title: "" });
  }
  const feed = st.feed;
  if (feed && feed.state === "on") {
    const a = feed.attributes || {};
    const which = Object.keys(a).filter((k) => a[k] && typeof a[k] === "object" && a[k].problem === true)
      .map((k) => FEED_NAMES[k] || k.replace(/_/g, " "));
    notices.push({ kind: "feed", mark: "accent", detail: "", title: "",
      parts: [{ text: "Feed problem" }, ...(which.length ? [{ text: which.join(" · "), muted: true }] : [])] });
  }
  if (unav) {
    notices.push({ kind: "wunav", mark: "muted", detail: "", parts: [{ text: "Couldn't reach the warnings feed" }],
      title: w ? `${opt.warningsId}: ${w.state}` : `${opt.warningsId} not found` });
  }
  if (!opt.full) {
    const kp = kikikuruPill(st.kikikuru);
    if (kp) chips.push({ text: kp.text, title: "キキクル (危険度分布) at home", ...chipColours(kp.colours), level: kp.level });
    const ta = liveAttrs(st.typhoon);
    for (const storm of (ta && Array.isArray(ta.storms) ? ta.storms : [])) {
      const p = typhoonPartsEn(storm, opt.tz);
      if (!p) continue;
      notices.push({ kind: "typhoon", mark: p.km <= TY_NEAR_KM ? "accent" : "muted", detail: p.when,
        parts: [{ text: p.name, strong: true }, { text: "· closest" }, { text: kmText(p.km), strong: true }],
        title: [...new Set([typhoonNumber(storm), storm.name_ja, storm.name_en].filter(Boolean))].join(" · ") });
    }
    // the nearest strike of the last lightning_minutes (o.strikes); the sensor (the LATEST strike) only when there are none
    const lp = opt.strikes && opt.strikes.length && opt.home ? nearestStrikePill(opt.strikes, opt.home)
      : lightningPill(st.lightning_distance, st.lightning_azimuth);
    if (lp) {
      notices.push({ kind: "lightning", mark: lp.near ? "accent" : "muted", detail: "", parts: [{ text: lp.text }],
        title: "Nearest lightning strike · Blitzortung.org" });
    }
  }
  return { chips, notices };
}

/**
 * The credit lines for what the card shows now: [{id, text, href?, title?}], in order. ctx = {map, baseMap, openMeteo, wbgt,
 * p2p, lightning}. JMA's credit and its "edited" statement come first and are never conditional: they are on the card in every
 * mode, with or without data, the square closed card included. The others are listed only while data from them is shown.
 * The map credit (`map`) is the ACTIVE base map's own, from `baseMap` (the config's `base_map`; default GSI): never another provider's.
 */
function attributionCredits(ctx) {
  const c = ctx || {};
  const ids = ["jma", "edited"];
  if (c.map) ids.push("map");
  if (c.openMeteo) ids.push("openmeteo");
  if (c.wbgt) ids.push("wbgt");
  if (c.p2p) ids.push("p2p");
  if (c.lightning) ids.push("blitz");
  return ids.map((id) => (id === "map" ? baseMapCredit(c.baseMap) : { id, ...CREDITS[id] }));
}

// ---- the visual editor (pure parts; the element is below). Pattern: <ha-form> over a schema, as in Home Assistant's own
// cards and in Mushroom; a named `expandable` entry holds a nested mapping (`entities`, `lightning`).
const EDITOR_ROLE_LABELS = {
  warnings: "Warnings", rain: "Rain next hour", frames: "Radar frames", overview: "Overview", feed: "Feed problem",
  quake: "Last earthquake", outlook: "Warning outlook", typhoon: "Typhoon", wbgt: "Heat index (WBGT)", kikikuru: "Kikikuru",
  rain_outlook: "Rain outlook (15 h)", japan: "Japan forecasts", tsunami: "Tsunami", heat_alert: "Heat alert", sun: "Sun",
};
const EDITOR_LABELS = {
  entity: "Weather entity", title: "Title", icon: "Icon", mode: "Mode", square: "Square (1:1) while closed",
  show_radar: "Show the radar thumbnail", base_map: "Base map", navigate: "Dashboard path to open on tapping the radar", alert_entity: "Alert entity (optional)",
  entities: "Other entities (found automatically)", lightning: "Lightning (Blitzortung, optional)",
  distance: "Distance sensor", azimuth: "Direction sensor", counter: "Counter sensor", source: "Strike source",
  minutes: "Show strikes from the last (minutes)",
  ...EDITOR_ROLE_LABELS,
};
const EDITOR_HELP = {
  entity: "A weather entity made by the JMA integration.",
  base_map: "Where the map pictures come from. A custom tile address is set in YAML (base_map: with url, attribution, max_zoom).",
  navigate: "Optional. Left empty, the radar and the chart are not links.",
  entities: "Only needed to replace one the card finds on the same device.",
};
const EDITOR_SCHEMA = [
  { name: "entity", required: true, selector: { entity: { domain: "weather", integration: JMA_PLATFORM } } },
  { name: "title", selector: { text: {} } },
  { name: "icon", selector: { icon: {} } },
  { name: "mode", selector: { select: { mode: "dropdown", options: [{ value: "compact", label: "Compact" }, { value: "full", label: "Full page" }] } } },
  { name: "square", selector: { boolean: {} } },
  { name: "show_radar", selector: { boolean: {} } },
  { name: "base_map", selector: { select: { mode: "dropdown", options: [
    { value: "gsi", label: "GSI pale map (国土地理院 淡色地図)" },
    { value: "osm", label: "OpenStreetMap" },
    { value: "esri", label: "Esri World Light Gray (legacy)" },
  ] } } },
  { name: "navigate", selector: { text: {} } },
  { name: "alert_entity", selector: { entity: {} } },
  { type: "expandable", name: "entities", title: EDITOR_LABELS.entities,
    schema: ENTITY_ROLES.map((role) => ({ name: role, selector: { entity: role === "sun" ? { domain: "sun" } : { integration: JMA_PLATFORM } } })) },
  { type: "expandable", name: "lightning", title: EDITOR_LABELS.lightning,
    schema: [
      { name: "distance", selector: { entity: { domain: "sensor" } } },
      { name: "azimuth", selector: { entity: { domain: "sensor" } } },
      { name: "counter", selector: { entity: { domain: "sensor" } } },
      { name: "source", selector: { text: {} } },
      { name: "minutes", selector: { number: { min: 1, max: 240, mode: "box" } } },
    ] },
];
const EDITOR_KEYS = EDITOR_SCHEMA.map((s) => s.name);

/** The data handed to <ha-form>: the config with the defaults filled in, so every control shows its real state. */
function editorData(config) {
  const c = config && typeof config === "object" ? config : {};
  return { ...c, mode: c.mode || DEFAULTS.mode, square: c.square === true, show_radar: c.show_radar !== false,
    base_map: c.base_map == null || c.base_map === "" ? DEFAULT_BASE_MAP : c.base_map,   // a custom mapping stays as it is (YAML only)
    entities: { ...(c.entities || {}) }, lightning: { ...(c.lightning || {}) } };
}

/**
 * The config to save after the form changed: the keys the form manages come from `value` (a key the form dropped was
 * cleared), every other key (type, grid_options, home, spans ...) stays as it was; empty and default values are left out.
 */
function cleanEditorConfig(prev, value) {
  const blank = (v) => v == null || v === "";
  const out = {};
  for (const [k, v] of Object.entries(prev || {})) if (!EDITOR_KEYS.includes(k)) out[k] = v;
  for (const k of EDITOR_KEYS) {
    const v = value ? value[k] : undefined;
    if (k === "entities" || k === "lightning") {
      const g = {};
      for (const [gk, gv] of Object.entries(v && typeof v === "object" ? v : {})) if (!blank(gv)) g[gk] = gv;
      if (Object.keys(g).length) out[k] = g;
    } else if (!blank(v)) out[k] = v;
  }
  if (out.mode === DEFAULTS.mode) delete out.mode;
  if (out.square === false) delete out.square;
  if (out.show_radar === true) delete out.show_radar;
  if (out.base_map === DEFAULT_BASE_MAP) delete out.base_map;
  return out;
}

const helpers = {
  // configuration, entity discovery, units, language, credits
  normaliseConfig, discoverSiblings, resolveRoles, pickStubEntity, isEntityId, tempUnit, toUnit, uiLocale, setLocale,
  attributionCredits, CREDITS, BASE_MAPS, BASE_MAP_IDS, DEFAULT_BASE_MAP, resolveBaseMap, baseMapCredit, tileTemplateProblem, SIBLING_KEYS, SIBLING_ROLES, ENTITY_ROLES, LIGHTNING_DEFAULTS, CARD_TAG, FALLBACK_TZ, JST, NBSP,
  // data helpers
  haversineKm, bearingDeg, fitZoom, japanDay, japanDayLabel, cityDay, cityMarks, lidenUrl, lidenFramesFor, lidenPoints, blitzStrikes,
  strikesBetween, strikeSummary, strikeLine, lightningPill, TY_MIN_SPAN_KM, JAPAN_MIN_SPAN_KM, CITY_ORDER,
  bandColour, levelColour, parseJmaTime, fmtTime, fmtDay, pillText, frameList, frameLabel,
  tileUrl, worldPx, gridTiles, nextHourText, intensityText, axisLabels, conditionIcon, tempColour,
  rangeBar, compass, summaryLine, summaryParts, prettyEn, toDate, ageText, staleText, sectionStale, safeJmaUrl,
  scrubMarks, spanZoom, homeLatLon, gustInUnit, hourStart, hourlyRows, isNight, popSlots, quakeLine,
  liveAttrs, phenShort, outlookCells, outlookLine, kikikuruWord, kikikuruColour, kikikuruParts, kikikuruPill,
  rainOutlookText, rainFromSuffix, fillTemplate, availableLayers, layerZoom, evenOnly, layerZoomIdx, layerTimeline,
  layerStamp, nextMember, typhoonNumber, typhoonPill, typhoonLines, projectPoint, kmToPx, typhoonGeometry, wbgtBand,
  typhoonParts, typhoonPartsEn, typhoonNumberEn, timeOnDayEn, nowBlock, chipColours, topBlock, tsunamiNotices, heatNotices,
  adviceNotices, alertNotices, nearestStrikePill, conditionWords, nbUnit,
  BAND_LABELS, BAND_COLOURS, BAND_HEIGHT, INTENSITY, DEFAULTS, LAYER_DEFS, RISK_SUBS, CARD_VERSION,
  jmaSymbol, dayKey, fmtHour, endHour, mdHourJa, dayTimeEn, maxLevel, layerUsable,
  TILE_RETRY_MS, retryTileOnce,
  // theme and editor
  BASE_TOKENS, DERIVED_TOKENS, tokenDecls, EDITOR_SCHEMA, EDITOR_LABELS, EDITOR_KEYS, editorData, cleanEditorConfig,
};
if (typeof module !== "undefined" && module.exports) module.exports = helpers;

// ------------------------------------------------------------------ the card

if (typeof HTMLElement !== "undefined") {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // a loading or empty line is a status row: icon, then the words
  const stateRow = (icon, text) => {
    const n = el("div", "state");
    n.setAttribute("role", "status");
    const i = el("ha-icon");
    i.setAttribute("icon", icon);
    i.setAttribute("aria-hidden", "true");
    n.append(i, el("span", "", text));
    return n;
  };

  class HaJmaCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._built = false;
      this._frames = [];
      this._layers = [];      // one layer per frame, built on demand (all of them only once Play is pressed)
      this._tileCtx = null;
      this._frameIdx = 0;
      this._playing = false;
      this._playToken = 0;
      this._zoomIdx = 0;
      this._radarKey = "";
      this._baseKey = "";
      this._lastRender = 0;
      this._hScroll = 0;
      this._daily = null;
      this._hourly = null;
      this._subs = {};        // forecast type -> its subscription promise
      this._subFailedAt = {}; // forecast type -> when its subscription was rejected
      this._fcAwait = {};     // forecast type -> true while a cached answer waits for the new subscription's
      this._fcTimers = {};    // forecast type -> the timer that ends the wait for a first message
      this._width = 0;
      this._height = 0;
      this._open = false;
      this._tab = "hourly";
      this._layerId = "rain";   // full page radar layer, remembered per browser
      this._riskSub = "inund";
      this._shownLayer = "rain";
      this._tl = null;          // the shown layer's timeline (layerTimeline)
      this._tyKey = "";
      this._tyStorms = [];
      this._view = null;        // {lat, lon, viewZ, w, h, layerId}: what the map shows
      this._cityKey = "";
      this._jpDate = "";        // the nationwide day on screen; "" = japanDay() decides
      this._liden = new Map();  // strike file URL -> points, or a promise while it is fetched
      this._blitz = [];
      this._blitzKey = "";
      this._shown = {};         // which optional data is on screen now (feels, hourly, wbgtTile, quakeRow, heat, tsunami): the credit line follows it
      this._rolesCache = null;
      try {
        this._open = localStorage.getItem(OPEN_KEY) === "1";
        this._tab = localStorage.getItem(TAB_KEY) || "hourly";
        const l = localStorage.getItem(LAYER_KEY);
        if (LAYER_DEFS.some((d) => d.id === l)) this._layerId = l;
        const r = localStorage.getItem(RISK_KEY);
        if (RISK_SUBS.some((d) => d.id === r)) this._riskSub = r;
      } catch (e) { /* private mode */ }
    }

    setConfig(config) {
      // The card picker previews getStubConfig() as it is, and with no ha-jma weather entity that is `entity: ""`. Only that
      // empty entity gets a plain "add a weather entity" card; every other bad configuration still throws below.
      if (config && typeof config === "object" && !Array.isArray(config) && config.entity === "") { this._showSetup(); return; }
      const prevEntity = this._config && this._config.entity;
      const next = normaliseConfig(config);   // throws a readable Error for a bad configuration; the old one stays
      this._config = next;
      this._rolesCache = null;
      this._shown = {};
      if (prevEntity && prevEntity !== this._config.entity) {
        // another weather entity: drop the old forecast subscription and its data
        this._unsubscribe();
        this._daily = null;
        this._hourly = null;
        this._fcAwait = {};
      }
      this._built = false;
      if (this._hass) {
        this._render();
        if (this.isConnected && this._hass.connection) this._subscribe();
      }
    }

    /** No weather entity chosen yet (the card picker's stub): one line saying what to add. With no configuration nothing else runs. */
    _showSetup() {
      if (this._ro) this._ro.disconnect();
      if (this._hostRo) { this._hostRo.disconnect(); this._hostRo = null; }
      this._stop();
      this._unsubscribe();
      this._config = null;
      this._rolesCache = null;
      this._el = null;
      this._built = false;
      const shell = el("ha-card", "setup");
      shell.appendChild(stateRow("mdi:weather-cloudy-alert", "Add a JMA weather entity: install the ha-jma integration, then choose its weather entity in this card's settings."));
      this.shadowRoot.replaceChildren(
        el("style", "", ":host { display: block; } ha-card { display: block; padding: 16px; } .state { display: flex; align-items: center; gap: 12px; color: var(--secondary-text-color); }"),
        shell,
      );
    }

    set hass(hass) {
      const prev = this._hass;
      this._hass = hass;
      setLocale(hass && hass.locale && hass.locale.language);
      const ids = this._config ? Object.values(this._roles()) : [];
      // a detached card (a hidden view, a dashboard edit) must not open subscriptions
      const live = !!(this._config && hass.connection && this.isConnected);
      // A reload of the integration re-creates the weather entity; its old forecast
      // subscription goes quiet, so subscribe again when it comes back.
      const was = live && prev && prev.states[this._config.entity];
      const now = live && hass.states[this._config.entity];
      // also an entity that was missing when the subscription was sent (its rejection is swallowed
      // in _subscribe, so nothing else would ever ask again)
      const back = !!now && now.state !== "unavailable" && (!was || was.state === "unavailable");
      // what the dropped subscriptions answered stays cached, but is not an answer to the new ones: until they
      // answer or are rejected an empty list reads "loading". Set before the render below, which redraws it.
      if (prev && back) this._fcAwait = { daily: true, hourly: true };
      // also once a minute on any hass update: ages, the current hour and finished rain slots move on
      if (!prev || ids.some((id) => id && prev.states[id] !== hass.states[id]) || prev.themes !== hass.themes
        || !!(prev.themes && prev.themes.darkMode) !== !!(hass.themes && hass.themes.darkMode) || prev.entities !== hass.entities || prev.locale !== hass.locale || Date.now() - this._lastRender > 60000) {
        this._render();
      }
      if (live) {
        if (prev && back) {
          this._unsubscribe();   // clears the mark and the timers: the new subscriptions are waited for from here
          this._fcAwait = { daily: true, hourly: true };
        }
        // a subscription rejected while the entity is there: THAT type is asked again after 60 s, at most once a minute;
        // the other type's healthy subscription is left alone 
        if (now && now.state !== "unavailable") {
          for (const type of Object.keys(this._subFailedAt)) {
            const at = this._subFailedAt[type], t = Date.now();
            if (at > t || t - at >= FC_RETRY_MS) this._unsubscribeType(type);   // a stamp ahead of the clock is due
          }
        }
        this._subscribe();   // makes only the types that have no subscription
      }
    }

    connectedCallback() {
      if (!this._ageTick) this._ageTick = setInterval(() => {
        if (this.isConnected && this._hass && this._config) this._render();
      }, 60000);
      if (this._ro && this._el) this._ro.observe(this._el.radar);
      if (this._hostRo) this._hostRo.observe(this);
      if (this._config && this._hass) this._subscribe();
    }

    disconnectedCallback() {
      clearInterval(this._ageTick);
      this._ageTick = null;
      this._unsubscribe();
      this._stop();
      if (this._ro) this._ro.disconnect();
      if (this._hostRo) this._hostRo.disconnect();
    }

    _unsubscribe() {
      Object.keys(this._subs).forEach((type) => this._unsubscribeType(type));
      this._subs = {};
      this._subFailedAt = {};
      this._fcAwait = {};
    }

    /** The timer that ends one type's wait for a first message. */
    _fcTimerOff(type) {
      clearTimeout(this._fcTimers[type]);
      delete this._fcTimers[type];
    }

    /** One forecast type: its subscription is torn down and its failure stamp cleared; the next _subscribe() makes it again. */
    _unsubscribeType(type) {
      const p = this._subs[type];
      if (p) p.then((unsub) => unsub && unsub()).catch(() => {});
      this._fcTimerOff(type);
      delete this._subs[type];
      delete this._subFailedAt[type];
    }

    getCardSize() { return this._config && this._config.mode === "full" ? 16 : 6; }
    getGridOptions() { return { columns: 12, min_columns: 6 }; }
    /** The card picker's starting configuration: the first ha-jma weather entity of the entity registry (clock-weather-card pattern). */
    static getStubConfig(hass) { return { entity: pickStubEntity(hass) }; }
    static getConfigElement() { return document.createElement(`${CARD_TAG}-editor`); }

    _subscribe() {
      const entity = this._config.entity;
      for (const type of ["daily", "hourly"]) {
        if (this._subs[type]) continue;   // healthy, or waiting for its own retry
        let p;   // this subscription's own handle: a callback acts only while it is still the current one
        const sub = this._hass.connection.subscribeMessage((msg) => {
          if (!this._config || this._config.entity !== entity) return;  // a late message for the old entity
          if (this._subs[type] !== p) return;   // a dropped subscription's late message changes nothing
          if (type === "daily") this._daily = msg.forecast; else this._hourly = msg.forecast;
          delete this._fcAwait[type];
          delete this._subFailedAt[type];
          this._fcTimerOff(type);
          this._renderMore();
        }, { type: "weather/subscribe_forecast", forecast_type: type, entity_id: entity });
        // a missing/unavailable weather entity rejects; resolve to "nothing to unsubscribe"
        p = sub.catch(() => {
          if (this._subs[type] === p) {
            this._fcTimerOff(type);
            this._subFailedAt[type] = Date.now();
            if (type === "daily") this._daily = null; else this._hourly = null;
            delete this._fcAwait[type];
            if (this.isConnected) this._renderMore();
          }
          return null;
        });
        this._subs[type] = p;
        // no message within the retry period: the unreachable words, the cached answer (if any) stays drawn, the
        // subscription is dropped and asked again; the mark stays set until an answer or a rejection
        this._fcTimerOff(type);
        this._fcTimers[type] = setTimeout(() => {
          delete this._fcTimers[type];
          if (this._subs[type] !== p || !this.isConnected) return;
          this._unsubscribeType(type);
          this._subFailedAt[type] = Date.now();
          this._renderMore();
          if (this._config && this._hass && this._hass.connection) this._subscribe();
        }, FC_RETRY_MS);
      }
    }

    /** Every role -> entity id (explicit config, else found on the weather entity's device); recomputed when hass.entities changes. */
    _roles() {
      const reg = this._hass && this._hass.entities;
      const c = this._rolesCache;
      if (!c || c.reg !== reg || c.cfg !== this._config) {
        this._rolesCache = { reg, cfg: this._config, roles: resolveRoles(this._config, this._hass) };
      }
      return this._rolesCache.roles;
    }
    _id(role) { return this._roles()[role] || null; }
    _st(role) {
      const id = this._hass && this._config ? this._id(role) : null;
      return id ? this._hass.states[id] : undefined;
    }
    get _tz() { return (this._hass && this._hass.config && this._hass.config.time_zone) || FALLBACK_TZ; }
    get _dark() { return !!(this._hass && this._hass.themes && this._hass.themes.darkMode); }
    get _full() { return this._config.mode === "full"; }
    get _night() {
      const s = this._st("sun");
      return !!(s && s.state === "below_horizon");
    }

    // ---------------------------------------------------------------- shell

    _build() {
      if (this._ro) this._ro.disconnect();  // setConfig can rebuild an already-built card
      if (this._hostRo) { this._hostRo.disconnect(); this._hostRo = null; }
      this._stop();
      this._radarKey = "";
      this._baseKey = "";
      this._tyKey = "";
      this._layers = [];
      const full = this._full;
      const square = !full && this._config.square;
      // Static fragments (our own strings only). Compact stacks them; full wraps them in a grid that
      // is one column when narrow and radar-left / forecast-right when the card is wide (panel view).
      // rows A (icon · numeral · H/L + Feels) and B (condition) · C warning chips · D notice lines
      const now = `
          <div class="now">
            <img class="icon" alt="" /><ha-icon class="micon" hidden></ha-icon>
            <div class="temp"><span class="t"></span><span class="deg">°</span></div>
            <div class="hilo"><div class="hd">Today</div><div class="hl"><span class="k">H</span> <span class="v hv"></span> <span class="k lk">L</span> <span class="v lv"></span></div><div class="feels"></div></div>
            <div class="cond"><span class="ja"></span><span class="en"></span></div>
          </div>
          <div class="chips" hidden></div>
          <div class="notices" hidden><div class="note now-note" hidden><span class="nw"></span></div><div class="note olook" hidden><span class="nw olt"></span></div></div>`;
      // JMA's own sentence for today (「くもり 所により 雨」): under the header in full, top of the drop-down in compact
      const jtext = `<div class="jtext" hidden></div>`;
      const next = `
          <div class="nexthour">
            <div class="nh-head"><span class="nh-title"></span><span class="nh-sub"></span><span class="note nh-note" hidden></span></div>
            <div class="nh-plot">
              <div class="guide g1"><span>1</span></div><div class="guide g10"><span>10</span></div><div class="guide g30"><span>30 mm/h</span></div>
              <div class="cols"></div>
            </div>
            <div class="nh-axis"></div>
          </div>`;
      // 降水短時間予報 at home: the next-hour chart's bands and guides, hourly (full page only)
      const r15 = `
          <div class="r15" hidden>
            <div class="r15-lbl">降水短時間予報 · next 15 h</div>
            <div class="nh-head"><span class="nh-title r15-title"></span><span class="nh-sub r15-sub"></span></div>
            <div class="nh-plot">
              <div class="guide g1"><span>1</span></div><div class="guide g10"><span>10</span></div><div class="guide g30"><span>30 mm/h</span></div>
              <div class="cols"></div>
            </div>
            <div class="nh-axis"></div>
          </div>`;
      // one legend per layer, values copied from JMA's / GSI's legend SVGs (2026-09-28); one shown at a time
      const legend = `<div class="legend lg-rain" data-l="rain" title="JMA rain intensity, mm/h"><i style="background:#F2F2FF"></i><i style="background:#A0D2FF"></i><i style="background:#218CFF"></i><i style="background:#0041FF"></i><i style="background:#FAF500"></i><i style="background:#FF9900"></i><i style="background:#FF2800"></i><i style="background:#B40068"></i><span>&lt;1</span><span>1</span><span>5</span><span>10</span><span>20</span><span>30</span><span>50</span><span>80+</span></div>
        <div class="legend lg-thunder" data-l="thunder" hidden><span class="lt">雷活動度</span><i style="background:#FFF500">1</i><i style="background:#FFAA00">2</i><i class="w" style="background:#FF2800">3</i><i class="w" style="background:#C800FF">4</i><span class="lt">竜巻発生確度</span><i style="background:#FAF500">1</i><i class="w" style="background:#FF2800">2</i><span class="lt">落雷</span><b class="sk cg" title="対地放電 · cloud to ground"></b><b class="sk cc" title="雲放電 · cloud to cloud"></b><span class="skt">対地 · 雲</span></div>
        <div class="legend lg-risk" data-l="risk" hidden><span class="lt lrt"></span><i class="k1" title="今後の情報等に留意"></i><i style="background:#F2E700"></i><i style="background:#FF2800"></i><i style="background:#AA00AA"></i><i style="background:#0C000C"></i><span title="今後の情報等に留意">留意</span><span>注意</span><span>警戒</span><span>危険</span><span>災害切迫</span></div>
        <div class="legend lg-flood" data-l="flood" hidden><span class="lt">浸水深 m · 想定最大規模</span><i style="background:linear-gradient(#F7F5A9 50%, #FFFFB3 50%)"></i><i style="background:#F7F5A9"></i><i style="background:linear-gradient(#FFD8C0 50%, #F8E1A6 50%)"></i><i style="background:#FFD8C0"></i><i style="background:#FFB7B7"></i><i style="background:#FF9191"></i><i style="background:#F285C9"></i><i style="background:#DC7ADC"></i><span class="ticks"><b style="left:12.5%">0.3</b><b style="left:25%">0.5</b><b style="left:37.5%">1</b><b style="left:50%">3</b><b style="left:62.5%">5</b><b style="left:75%">10</b><b style="left:87.5%">20</b></span><span class="lat"></span></div>
        <div class="legend lg-sat" data-l="sat" hidden><span class="lt">ひまわり 赤外</span><i class="grad"></i><span class="l0">暖</span><span class="l1">冷 · 高い雲</span></div>`;
      // Dark map: the <1 mm/h band (#F2F2FF) must not be the brightest thing on it. This filter keeps
      // every colour and scales the ALPHA of near-white pixels only (W = 1 at #F2F2FF, 0 at #A0D2FF
      // and every other band), in sRGB. Transparent pixels give W = 0 and stay transparent.
      const fx = `<svg class="fx" width="0" height="0" aria-hidden="true" focusable="false"><filter id="jc-dim" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" result="w" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  5.76 2.88 2.88 0 -10.08" /><feComposite in="SourceGraphic" in2="w" operator="arithmetic" k1="-0.65" k2="1" k3="0" k4="0" /></filter></svg>`;
      // full: the typhoon track overlay sits above the frames and under the home marker
      const radar = `
          <div class="radar">${fx}<div class="base"></div><div class="frames"></div>${full ? `<svg class="tyo" aria-hidden="true" focusable="false"></svg>` : ""}<canvas class="bolts" aria-hidden="true"></canvas><div class="labels" aria-hidden="true"></div>${full ? `<div class="cities" aria-hidden="true"></div>` : ""}<div class="home"></div>
            <div class="stamp"></div><div class="noradar" hidden>No radar picture</div>${full ? legend : ""}</div>`;
      const lbar = `
          <div class="lbar"><div class="lchips" role="group" aria-label="Map layer"></div><div class="lsubs" role="group" aria-label="キキクル" hidden></div></div>
          <div class="lnote" role="status" hidden></div>`;
      const controls = `
          <div class="controls">
            <button class="play" type="button" aria-label="Play">▶</button>
            <div class="scrubwrap">
              <div class="strack" aria-hidden="true"><span class="sfc"></span><span class="snow"></span></div>
              <input class="scrub" type="range" min="0" max="0" value="0" aria-label="Frame" />
              <span class="nofc" hidden>No forecast frames</span>
            </div>
            <div class="zooms"></div>
          </div>`;
      const toggle = `
          <button class="toggle" type="button" aria-expanded="false">
            <span class="sum"></span><span class="chev" aria-hidden="true"></span><span class="tlabel">More</span>
          </button>`;
      const more = `
          <div class="more">
            ${full ? "" : `${jtext}<div class="tabs" role="tablist"></div>`}
            <section class="warnings" data-tab="warnings"><h3>警報・注意報 <span>Warnings</span></h3><div class="wlist"></div><div class="headline"></div>
              <div class="kiki" hidden><span class="kt"></span><span class="kv"></span></div>
              <div class="ol" hidden><div class="olh">今後24時間 <span>Next 24 h · 警報級の可能性</span></div><div class="olcells"></div><div class="olnote" hidden></div><div class="olkey">colour = warning level JMA expects · mm = max 1-h rain</div></div>
              <a class="jma" target="_blank" rel="noopener">JMA warning page ↗</a></section>
            <section class="hourly" data-tab="hourly"><h3>毎時 <span>Next 24 hours · Open-Meteo (JMA MSM)</span></h3><div class="hstrip"></div><div class="hkey" hidden>雲量 · bottom row = cloud cover %</div></section>
            <section class="pops6" data-tab="details"><h3>降水確率 <span>Rain chance · 6 h</span></h3><div class="pops"></div></section>
            <section class="week" data-tab="week"><h3>週間予報 <span>7 days</span></h3><div class="days"></div><div class="wkey" hidden></div></section>
            ${full ? `<section class="typhoon" hidden><h3>台風 <span>Typhoon</span></h3><div class="tylist"></div><div class="tykey">Track and forecast circles: on the map at the Region and Japan zoom</div></section>
            <section class="japan" hidden><h3>全国 <span class="jpsub">Japan</span></h3><div class="jpdays" role="group" aria-label="Day"></div><div class="jplist"></div><button class="jpmore" type="button" hidden></button><div class="jpkey">JMA forecast for each office's city · marks on the map at Japan zoom</div></section>` : ""}
            <section class="details" data-tab="details"><h3>現在 <span>Now</span></h3><div class="tiles"></div><div class="drows"></div></section>
            <section class="overview" data-tab="details"><h3>天気概況 <span>JMA overview</span></h3><div class="otext"></div></section>
          </div>`;
      // JMA's credit is in the shell itself, so it is on the card before the first render and whatever fails later
      const attr = `<div class="attr"><span class="src">${CREDITS.jma.text}</span> · <span class="src">${CREDITS.edited.text}</span></div>`;
      // the card header, inside the card (text and icon are written below with textContent / setAttribute)
      const chead = `<div class="chead" hidden><ha-icon class="chi"></ha-icon><span class="cht"></span></div>`;
      const body = full
        ? `${chead}<div class="fullgrid"><div class="left">${radar}${lbar}${controls}</div><div class="right">${now}${jtext}${next}${r15}${more}</div></div>${attr}`
        : `${chead}${now}${next}${radar}${toggle}${more}${attr}`;
      this.shadowRoot.innerHTML = `
        <style>${this._css()}</style>
        <ha-card class="${full ? "full" : "compact"}${square ? " square" : ""}${this._config.navigate ? " nav" : ""}${this._dark ? " dark" : ""}${!full && this._config.show_radar === false ? " noradar" : ""}">${body}
        </ha-card>`;
      const $ = (s) => this.shadowRoot.querySelector(s);
      {
        const ct = this._config.title;
        const hd = $(".chead");
        hd.hidden = !ct;
        $(".cht").textContent = ct || "";
        const ci = $(".chi");
        // round 2: the compact card's live symbol sits right under the title, so it does not also get a header glyph
        if (this._config.icon && full) ci.setAttribute("icon", this._config.icon); else ci.hidden = true;
      }
      this._el = {
        card: $("ha-card"), icon: $(".icon"), micon: $(".micon"), t: $(".t"), deg: $(".deg"), cond: $(".cond"), ja: $(".cond .ja"), en: $(".cond .en"),
        hv: $(".hv"), lv: $(".lv"), feels: $(".feels"), chips: $(".chips"), notices: $(".notices"),
        now: $(".now"), nowNote: $(".now-note"), nowNoteText: $(".now-note > .nw"), jtext: $(".jtext"),
        nhTitle: $(".nh-title"), nhSub: $(".nh-sub"), nhNote: $(".nh-note"), cols: $(".cols"), axis: $(".nh-axis"), nexthour: $(".nexthour"),
        radar: $(".radar"), base: $(".base"), labels: $(".labels"), frames: $(".frames"), stamp: $(".stamp"), noradar: $(".radar > .noradar"),
        legend: $(".legend"), play: $(".play"), scrub: $(".scrub"), sfc: $(".sfc"), snow: $(".snow"), nofc: $(".nofc"),
        zooms: $(".zooms"), toggle: $(".toggle"), sum: $(".sum"),
        more: $(".more"), warnings: $(".warnings"), wlist: $(".wlist"), headline: $(".headline"), jma: $(".jma"),
        hstrip: $(".hstrip"), hkey: $(".hkey"), pops: $(".pops"), days: $(".days"), wkey: $(".wkey"), tiles: $(".tiles"), drows: $(".drows"),
        otext: $(".otext"), overview: $(".overview"), tabs: $(".tabs"),
        olook: $(".olook"), olookText: $(".olook > .olt"),
        kiki: $(".kiki"), kikiT: $(".kiki > .kt"), kikiV: $(".kiki > .kv"),
        ol: $(".ol"), olcells: $(".olcells"), olnote: $(".olnote"),
        typhoon: $(".typhoon"), tylist: $(".tylist"), tyo: $(".tyo"),
        bolts: $(".bolts"), cities: $(".cities"), lnote: $(".lnote"),
        japan: $(".japan"), jpsub: $(".jpsub"), jpdays: $(".jpdays"), jplist: $(".jplist"), jpmore: $(".jpmore"),
        r15: $(".r15"), r15Title: $(".r15-title"), r15Sub: $(".r15-sub"), r15Cols: $(".r15 .cols"),
        r15Axis: $(".r15 .nh-axis"), r15Plot: $(".r15 .nh-plot"),
        legends: Array.from(this.shadowRoot.querySelectorAll(".radar > .legend")), lrt: $(".lrt"), lk1: $(".lg-risk > .k1"),
        lat: $(".lg-flood > .lat"), lchips: $(".lchips"), lsubs: $(".lsubs"), scrubwrap: $(".scrubwrap"),
        attr: $(".attr"),
      };
      // keep the hourly strip where the user left it across re-renders (read on scroll: a hidden
      // tab reports scrollLeft 0)
      if (this._el.jpmore) this._el.jpmore.addEventListener("click", () => { this._jpAll = !this._jpAll; this._renderJapan(); });
      this._el.hstrip.addEventListener("scroll", () => { this._hScroll = this._el.hstrip.scrollLeft; }, { passive: true });
      // compact tabs: built once, so a hass update never takes focus away from them
      this._tabBtns = {};
      if (this._el.tabs) {
        for (const t of TABS) {
          const b = el("button", `tab${t.id === "warnings" ? " warn" : ""}`);
          b.type = "button";
          b.setAttribute("role", "tab");
          b.append(el("span", "tja", t.ja), el("span", "ten", t.en));
          b.addEventListener("click", () => {
            this._tab = t.id;
            try { localStorage.setItem(TAB_KEY, t.id); } catch (e) { /* private mode */ }
            this._renderMore();
          });
          this._tabBtns[t.id] = b;
          this._el.tabs.appendChild(b);
        }
      }
      const go = () => {
        if (!this._config.navigate) return;
        history.pushState(null, "", this._config.navigate);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      };
      if (full) {
        this._el.play.addEventListener("click", () => (this._playing ? this._stop() : this._play()));
        this._el.scrub.addEventListener("input", (e) => { this._stop(); this._show(+e.target.value); });
        const labels = Array.isArray(this._config.zoom_labels) ? this._config.zoom_labels : [];
        (Array.isArray(this._config.spans) ? this._config.spans : []).forEach((km, i) => {
          const b = el("button", "", labels[i] || `${km} km`);
          b.type = "button";
          b.title = `about ${km} km across`;
          b.addEventListener("click", () => { this._zoomIdx = i; this._radarKey = ""; this._renderRadar(); this._markZoom(); });
          this._el.zooms.appendChild(b);
        });
        // layer chips: built once; a render only hides / marks them
        this._chipBtns = {};
        for (const d of LAYER_DEFS) {
          const b = el("button", "chip", d.ja);
          b.type = "button";
          b.title = d.en;
          b.dataset.l = d.id;
          b.addEventListener("click", () => this._setLayer(d.id));
          this._chipBtns[d.id] = b;
          this._el.lchips.appendChild(b);
        }
        this._subBtns = {};
        for (const r of RISK_SUBS) {
          const b = el("button", "chip sub", r.ja);
          b.type = "button";
          b.title = `キキクル ${r.ja}`;
          b.addEventListener("click", () => this._setLayer("risk", r.id));
          this._subBtns[r.id] = b;
          this._el.lsubs.appendChild(b);
        }
        this._markZoom();
      } else {
        this._el.radar.addEventListener("click", go);
        this._el.nexthour.addEventListener("click", go);
        // both open the weather page on a click: Enter and Space do the same
        if (this._config.navigate) {
          for (const n of [this._el.radar, this._el.nexthour]) {
            n.setAttribute("tabindex", "0");
            n.setAttribute("role", "button");
            n.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
            });
          }
        }
        this._el.toggle.addEventListener("click", () => this._setOpen(!this._open));
      }
      this._ro = new ResizeObserver(() => {
        const w = Math.round(this._el.radar.clientWidth);
        const h = Math.round(this._el.radar.clientHeight);
        // no size = hidden (a closed pop-up, a hidden tab): the loop must not go on asking JMA for tiles
        if (!w && this._playing) this._stop();
        if ((w && w !== this._width) || (h && h !== this._height) || (w && this._radarSkipped)) {
          this._width = w; this._height = h; this._radarKey = ""; this._renderRadar();
        }
      });
      this._ro.observe(this._el.radar);
      {
        // the host is observed in the compact card too; "tight" (under 400 px) is the only class the compact card takes from it
        this._hostRo = new ResizeObserver(() => {
          const tight = this.clientWidth > 0 && this.clientWidth < TIGHT_BELOW;
          if (tight !== this._el.card.classList.contains("tight")) this._el.card.classList.toggle("tight", tight);
          if (!full) return;
          const wide = this.clientWidth >= WIDE_AT;
          this._measureHeader();
          if (wide !== this._el.card.classList.contains("wide")) this._el.card.classList.toggle("wide", wide);
          const narrow = this.clientWidth > 0 && this.clientWidth < NARROW_BELOW;
          if (narrow !== this._el.card.classList.contains("narrow")) this._el.card.classList.toggle("narrow", narrow);
        });
        this._hostRo.observe(this);
      }
      this._built = true;
      this._applyOpen();
    }

    _markZoom() {
      const spans = this._config.spans || [];
      Array.from(this._el.zooms.children).forEach((b, i) => {
        b.classList.toggle("on", i === this._zoomIdx);
        // a layer that needs a wider view (衛星) disables the presets narrower than that
        b.disabled = layerZoomIdx(this._shownLayer, i, spans) !== i;
      });
    }

    /** Full page: pick a map layer (and the キキクル element); remembered per browser. */
    _setLayer(id, sub) {
      this._layerId = id;
      if (sub) this._riskSub = sub;
      try {
        localStorage.setItem(LAYER_KEY, id);
        if (sub) localStorage.setItem(RISK_KEY, sub);
      } catch (e) { /* private mode */ }
      this._stop();
      this._radarKey = "";
      this._renderRadar();
    }

    _setOpen(open) {
      this._open = open;
      try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (e) { /* private mode */ }
      this._applyOpen();
      if (open) this._renderMore();
    }

    _applyOpen() {
      const el = this._el;
      const open = this._full || this._open;
      if (!this._full) {
        el.card.classList.toggle("open", open);
        el.toggle.setAttribute("aria-expanded", String(open));
        el.toggle.querySelector(".tlabel").textContent = open ? "Less" : "More";
      }
      el.more.hidden = !open;
    }

    // ---------------------------------------------------------------- render

    /** HA's real header height (0 while kiosk-mode hides it) into --jc-stick-top; left unset when HA's header is not found,
     *  where the CSS falls back to var(--kiosk-header-height, var(--header-height, 56px)). */
    _measureHeader() {
      let h = null;
      try {
        let node = this;
        for (let i = 0; i < 24 && node && h === null; i += 1) {
          if (node.tagName === "HUI-ROOT" && node.shadowRoot) {
            const hd = node.shadowRoot.querySelector(".header");
            h = hd ? Math.max(0, Math.round(hd.getBoundingClientRect().height)) : null;
            break;
          }
          const root = node.getRootNode ? node.getRootNode() : null;
          node = (root && root.host) || node.parentElement;
        }
      } catch (err) { h = null; }
      if (h === null) this.style.removeProperty("--jc-stick-top");
      else this.style.setProperty("--jc-stick-top", `${h}px`);
    }

    _render() {
      if (!this._hass || !this._config) return;
      if (!this._built) this._build();
      this._lastRender = Date.now();
      this._renderTheme();
      this._measureHeader();
      this._renderNow();
      this._renderPills();
      this._renderNextHour();
      this._renderRain15();
      this._renderRadar();
      this._renderMore();
      this._renderAttr();
    }

    /** hass.themes.darkMode picks the dark palette and the dark map; the class is the only thing that changes. */
    _renderTheme() {
      const card = this._el && this._el.card;
      if (card) card.classList.toggle("dark", this._dark);
    }

    /**
     * The credit line, always on the card (every mode, the closed square card too). JMA's credit and its "edited" statement are
     * unconditional; Open-Meteo is added while the hourly strip or the feels-like figure is shown (and the weather entity's own
     * attribution names it), 環境省 while the WBGT tile or a heat-stroke line is shown, P2P地震情報 while a quake or tsunami
     * line is shown, Blitzortung.org once `lightning:` names a counter that exists, and the map credit while a map is drawn
     * (the credit of the base map in use: GSI by default, never another provider's).
     */
    _renderAttr() {
      if (!this._el || !this._el.attr) return;
      const s = this._shown || {};
      const wa = liveAttrs(this._st("entity"));
      const own = wa && typeof wa.attribution === "string" ? wa.attribution : null;
      const credits = attributionCredits({
        map: this._full || this._config.show_radar !== false,
        baseMap: this._config.base_map,
        openMeteo: (own == null || /open-meteo/i.test(own)) && !!(s.feels || s.hourly),
        wbgt: !!(s.wbgtTile || s.heat),
        p2p: !!(s.quakeRow || s.tsunami),
        lightning: !!this._st("lightning_counter"),
      });
      const key = credits.map((c) => `${c.id}:${c.text}`).join("|");   // the map credit's text changes with `base_map`
      if (this._el.attr._key === key) return;
      this._el.attr._key = key;
      // each credit is one unbreakable piece: a narrow line breaks between credits, never inside one
      const piece = (c) => {
        const n = el("span", "src");
        if (c.href) {
          const a = el("a", "", c.text);
          a.setAttribute("href", c.href);
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener");
          n.appendChild(a);
        } else n.textContent = c.text;
        if (c.title) n.title = c.title;
        return n;
      };
      this._el.attr.replaceChildren(...credits.flatMap((c, i) => (i ? [" · ", piece(c)] : [piece(c)])));
    }

    _renderMore() {
      if (!this._el) return;
      if (!(this._full || this._open)) {
        Object.assign(this._shown, { hourly: false, wbgtTile: false, quakeRow: false });
        this._renderAttr();
        return;
      }
      this._renderTabs();
      this._renderWarnings();
      this._renderTyphoon();
      this._renderJapan();
      this._renderHourly();
      this._renderPops();
      this._renderWeek();
      this._renderDetails();
      this._renderOverview();
      this._renderAttr();
    }

    _renderNow() {
      const w = this._st("entity");
      const e = this._el;
      const n = nowBlock(w, !this._full);
      this._shown.feels = !!n.feels;
      // greyed from the weather entity's OWN age (AMeDAS observed_at), not the other sensors'
      const st = sectionStale("weather", w, Date.now(), this._tz);
      e.now.classList.toggle("stale", st.stale);
      // a gone entity: "—" and "Weather unavailable" ARE the statement, so the CSS keeps them at full strength
      e.now.classList.toggle("gone", !n.ok);
      e.nowNoteText.textContent = n.ok && st.stale ? st.text : "";
      e.nowNote.hidden = !(n.ok && st.stale);
      e.t.textContent = n.temp;
      e.t.classList.toggle("na", n.temp === "—");
      e.deg.hidden = n.temp === "—";
      e.deg.textContent = n.unit;
      // the name and icon are JMA's forecast for today; the row's title says so
      e.ja.textContent = n.ja;
      e.en.textContent = n.en;
      e.cond.title = n.title;
      e.hv.textContent = n.hi;
      e.lv.textContent = n.lo;
      e.hv.classList.toggle("na", n.hi === "—");
      e.lv.classList.toggle("na", n.lo === "—");
      // an empty Feels line still holds its line (a no-break space), so H/L never drops onto the baseline
      e.feels.textContent = n.feels || "\u00a0";
      if (n.icon) { e.icon.src = JMA_ICON + n.icon; e.icon.hidden = false; } else e.icon.hidden = true;
      // the compact card shows the JMA colour pictogram like the full page
      e.micon.hidden = true;
      if (!n.ok) {
        if (e.sum) e.sum.textContent = "";
        e.jtext.textContent = ""; e.jtext.hidden = true;
        return;
      }
      const a = w.attributes;
      // "くもり 時々 雨" beside 「曇時々雨」 is the same thing twice; a longer text (所により 雷を伴う …) adds something
      const jt = String(a.jma_text || "").replace(/\s+/g, "");
      e.jtext.textContent = a.jma_text || "";
      e.jtext.hidden = jt.length <= 8;
      if (e.sum) {
        e.sum.replaceChildren(...summaryParts(a).map((p) => { const n = el("span", "si"); n.append(el("span", "sl", p.label), el("span", "sv", p.value)); return n; }));
        e.sum.title = summaryLine(a);
      }
    }

    /** Rows C (warning chips) and D (notice lines: the weather's stale note, topBlock's lines, the outlook line). */
    _renderPills() {
      const e = this._el;
      // the full page has the キキクル line and the 台風 section, so those two are compact only
      const { chips, notices } = topBlock({
        warnings: this._st("warnings"), feed: this._st("feed"), kikikuru: this._st("kikikuru"), typhoon: this._st("typhoon"),
        lightning_distance: this._st("lightning_distance"), lightning_azimuth: this._st("lightning_azimuth"),
        tsunami: this._st("tsunami"), heat_alert: this._st("heat_alert"), alert_latest: this._st("alert_latest"), quake: this._st("quake"),
      }, { full: this._full, tz: this._tz, warningsId: this._id("warnings") || "the warnings sensor", now: Date.now(), ...this._strikeInput() });
      e.chips.replaceChildren(...chips.map((c) => {
        const p = el("span", "wchip", c.text);
        chipTone(p, c.level, c.bg, c.fg);
        p.title = c.title;
        return p;
      }));
      e.chips.hidden = !chips.length;
      e.notices.querySelectorAll(".note.dyn").forEach((n) => n.remove());
      for (const x of notices) {
        const line = el("div", `note dyn${x.mark === "accent" ? " accent" : ""}${/^[a-z]+$/.test(x.kind || "") ? ` k-${x.kind}` : ""}`);
        const words = el("span", "nw");
        const floated = x.detail && (x.kind === "advice" || x.kind === "tsunamijp");
        if (floated) words.append(el("span", "nd f", x.detail), " ");
        x.parts.forEach((p, i) => {
          if (i) words.append(" ");
          words.append(p.strong || p.muted ? el("span", p.strong ? "b" : p.text.startsWith("·") ? "m j" : "m", p.text) : p.text);
        });
        line.append(words);
        if (x.detail && !floated) line.append(el("span", "nd", x.detail));
        if (x.title) line.title = x.title;
        e.notices.insertBefore(line, e.olook);
      }
      this._renderOutlookLine();
      e.notices.hidden = !notices.length && e.nowNote.hidden && e.olook.hidden;
      this._shown.heat = notices.some((x) => /^heat/.test(x.kind || ""));
      this._shown.tsunami = notices.some((x) => /^tsunami/.test(x.kind || "") && x.kind !== "tsunamiunav");
    }

    /** Compact: the last notice line while the outlook peaks at level 2 or more (dot in the level's colour). */
    _renderOutlookLine() {
      const e = this._el;
      const a = this._full ? null : liveAttrs(this._st("outlook"));
      const text = a ? outlookLine(a, this._tz, Date.now()) : "";
      e.olook.hidden = !text;
      e.olookText.textContent = text;
      if (text) {
        const [bg] = levelColour(num(a.peak.level));
        e.olook.style.setProperty("--dot", bg);
        e.olook.title = "JMA 警報級の可能性 (warning outlook)";
      }
    }

    _renderNextHour() {
      const s = this._st("rain");
      const e = this._el;
      const attrs = s && s.state !== "unavailable" && s.state !== "unknown" ? s.attributes : null;
      const { title, sub } = nextHourText(attrs, this._tz);
      e.nhTitle.textContent = title;
      // compact: a dry next hour says when the 15-h forecast (rasrf) brings rain
      const later = this._full ? "" : rainFromSuffix(attrs, liveAttrs(this._st("rain_outlook")), this._tz, Date.now());
      e.nhSub.textContent = sub + later;
      // greyed from the rain sensor's own basetime
      const st = sectionStale("rain", s, Date.now(), this._tz);
      e.nexthour.classList.toggle("stale", st.stale);
      e.nhNote.textContent = attrs && st.stale ? st.text : "";
      e.nhNote.hidden = !(attrs && st.stale);
      const series = (attrs && Array.isArray(attrs.series) && attrs.series) || [];
      const peak = Math.max(0, ...series.map((p) => p.band || 0));
      e.nexthour.classList.toggle("dry", peak < 2);
      e.cols.replaceChildren();
      series.forEach((p, i) => {
        const c = el("div", `col${p.band == null ? " unknown" : ""}${i === 0 ? " now" : ""}`);
        const bar = el("div", "bar");
        const hFrac = p.band == null ? 0 : BAND_HEIGHT[p.band] || 0;
        bar.style.height = hFrac ? `${Math.round(hFrac * 100)}%` : "2px";
        bar.style.background = p.band ? bandColour(p.band) : "var(--jc-line)";
        c.title = `${fmtTime(new Date(p.time), this._tz)} · ${p.band ? `${BAND_LABELS[p.band]} mm/h` : p.band === 0 ? "dry" : "no data"}`;
        c.appendChild(bar);
        e.cols.appendChild(c);
      });
      e.axis.replaceChildren();
      // 13-slot geometry (Now … +60) even when only the observed frame came through
      const n = Math.max(series.length, 13);
      for (const l of axisLabels(series, this._tz)) {
        const t = el("span", "", l.text);
        t.title = l.time;
        t.style.left = `${((l.index + 0.5) / n) * 100}%`;
        e.axis.appendChild(t);
      }
    }

    /** Full page: 降水短時間予報 at home, one column per hourly frame (rasrf), JMA bands. */
    _renderRain15() {
      const e = this._el;
      if (!e.r15) return;
      const st = this._st("rain_outlook");
      // not in HA at all: nothing; unavailable: the section says so, greyed
      e.r15.hidden = !st;
      if (!st) return;
      const a = liveAttrs(st);
      const tz = this._tz;
      const nh = liveAttrs(this._st("rain"));
      const wetNow = !!nh && (!!nh.raining_now || nh.minutes_to_rain != null);
      const { title, sub } = a ? rainOutlookText(a, tz, Date.now(), wetNow) : { title: "No data", sub: "" };
      e.r15Title.textContent = title;
      e.r15Sub.textContent = sub;
      e.r15.classList.toggle("stale", !a);
      const series = (a && Array.isArray(a.series) ? a.series : []).filter((p) => p && toDate(p.time));
      e.r15.classList.toggle("dry", Math.max(0, ...series.map((p) => num(p.band) || 0)) < 2);
      e.r15Plot.hidden = !series.length;
      e.r15Cols.replaceChildren();
      for (const p of series) {
        const band = num(p.band);
        const c = el("div", `col${band == null ? " unknown" : ""}`);
        const bar = el("div", "bar");
        const hFrac = band == null ? 0 : BAND_HEIGHT[Math.min(8, band)] || 0;
        bar.style.height = hFrac ? `${Math.round(hFrac * 100)}%` : "2px";
        bar.style.background = band ? bandColour(band) : "var(--jc-line)";
        // rasrf is the 1-h amount ENDING at the frame's time
        c.title = `1 h to ${fmtTime(toDate(p.time), tz)} · ${band ? `${BAND_LABELS[Math.min(8, band)]} mm/h` : band === 0 ? "dry" : "no data"}`;
        c.appendChild(bar);
        e.r15Cols.appendChild(c);
      }
      e.r15Axis.replaceChildren();
      const n = series.length;
      const idx = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (n - 1))))].filter((i) => i >= 0 && i < n);
      for (const i of n ? idx : []) {
        const t = el("span", "", fmtTime(toDate(series[i].time), tz));
        t.style.left = `${((i + 0.5) / n) * 100}%`;
        e.r15Axis.appendChild(t);
      }
    }

    _renderRadar() {
      const s = this._st("frames");
      const e = this._el;
      // a detached card, or a radar box with no size (a closed pop-up, a hidden tab): nothing is rebuilt
      // (the skip is remembered: when the box is shown again at the SAME size the observer rebuilds it)
      if (!e || !this._width || !this.isConnected || !e.radar.clientWidth) { this._radarSkipped = true; return; }
      this._radarSkipped = false;
      const attrs = s && s.state !== "unavailable" && s.state !== "unknown" ? s.attributes : null;
      const full = this._full;
      const dark = this._dark;
      // which layer: the compact card is always the rain radar; the full page falls back to
      // 雨 while the chosen layer has no data (the choice itself is kept)
      const avail = full ? availableLayers(attrs) : [];
      const layerId = full && avail.includes(this._layerId) ? this._layerId : "rain";
      if (layerId !== this._shownLayer) { this._shownLayer = layerId; if (full) this._markZoom(); }
      // no tile_template (an older or broken sensor) = no radar, never an "undefined" tile URL
      // キキクル: the chosen element, or the first one the backend serves
      const L = (attrs && attrs.layers) || {};
      const sub = (RISK_SUBS.find((r) => r.id === this._riskSub && layerUsable(L, r.key))
        || RISK_SUBS.find((r) => layerUsable(L, r.key)) || RISK_SUBS[0]).id;
      const tl = layerTimeline(layerId, sub, attrs);
      const frames = tl.items;
      // theme changes only swap classes; nothing is refetched
      e.base.classList.toggle("night", dark);
      e.labels.classList.toggle("night", dark);
      e.frames.classList.toggle("night", dark);
      e.frames.classList.toggle("daymap", !dark);
      e.frames.classList.toggle("sat", layerId === "sat");
      for (const l of e.legends) l.classList.toggle("night", dark);
      if (full) this._renderLayerControls(avail, layerId, sub, tl, L);
      // greyed from the frames sensor's own basetime (the nowcast); other layers expire in the backend
      e.radar.classList.toggle("stale", layerId === "rain" && !!frames.length && sectionStale("frames", s, Date.now(), this._tz).stale);
      if (e.nofc) e.nofc.hidden = layerId !== "rain" || !frames.length || frames.some((f) => f.kind === "forecast");
      const home = homeLatLon(this._config.home, attrs && attrs.home, this._hass.config);
      // compact shows the "now" frame only: no such frame is no radar, not an empty box
      e.noradar.hidden = !!(full ? frames.length : frames.filter((f) => f.kind === "now").length) && !!home;
      e.noradar.textContent = layerId === "rain" ? "No radar picture" : "No layer picture";
      if (!home) return;
      const [lat, lon] = home;
      const h = Math.round(e.radar.clientHeight) || (full ? 360 : 140);
      const spans = this._config.spans || [];
      if (full) {
        // 衛星 needs a wide view: it moves the first preset up to the next (the first button is disabled meanwhile)
        const zi = layerZoomIdx(layerId, this._zoomIdx, spans);
        if (zi !== this._zoomIdx) { this._zoomIdx = zi; this._markZoom(); }
      }
      // full: a preset is a SPAN (km across this radar's width), so the first preset is ~15 km on a phone and on
      // a wall display alike; compact: config `zoom` (default 10)
      const viewZ = full && spans.length
        ? fitZoom(this._width, h, spans[Math.min(this._zoomIdx, spans.length - 1)], lat)
        : Number(this._config.zoom) || 10;
      // the base map has its own key: it does not change with the 5-minute basetime
      const bm = resolveBaseMap(this._config.base_map);
      const baseZ = Math.max(2, Math.min(bm.maxZoom, Math.round(viewZ)));
      const baseKey = `${viewZ}|${lat},${lon}|${this._width}|${h}`;
      if (baseKey !== this._baseKey) {
        this._baseKey = baseKey;
        e.base.replaceChildren();
        e.labels.replaceChildren();
        for (const t of gridTiles(lat, lon, viewZ, baseZ, this._width, h)) {
          const img = el("img");
          const baseUrl = fillTemplate(bm.url, null, baseZ, t.x, t.y);
          // a failed base tile is asked once more after TILE_RETRY_MS (J5)
          let baseRetried = false;
          img.addEventListener("error", () => {
            if (baseRetried) return;
            baseRetried = true;
            retryTileOnce(img, baseUrl);
          });
          img.src = baseUrl;
          this._place(img, t);
          e.base.appendChild(img);
          // the labels: the same tile, on top of the radar (a tile that fails just leaves the map unlabelled;
          // it is asked once more after TILE_RETRY_MS and shown again if that loads, J5). GSI, OSM and a custom map have
          // their labels in the base picture and no label layer.
          if (!bm.labelUrl) continue;
          const lab = el("img");
          const labUrl = fillTemplate(bm.labelUrl, null, baseZ, t.x, t.y);
          let labRetried = false;
          lab.addEventListener("error", () => {
            lab.style.visibility = "hidden";
            if (labRetried) return;
            labRetried = true;
            retryTileOnce(lab, labUrl, () => { lab.style.visibility = ""; });
          });
          lab.src = labUrl;
          this._place(lab, t);
          e.labels.appendChild(lab);
        }
      }
      this._view = { lat, lon, viewZ, w: this._width, h, layerId, baseKey };
      if (full) {
        this._renderTyphoonTrack(lat, lon, viewZ, h, baseKey);
        this._renderCities();
      }
      const key = `${layerId}|${layerId === "risk" ? sub : ""}|${tl.base}|`
        + `${frames.map((f) => `${f.basetime}/${f.member || ""}/${f.validtime}`).join(",")}|${baseKey}`;
      if (key === this._radarKey) {
        if (!this._playing) this._show(this._frameIdx);  // refreshes the stamp's age
        return;
      }
      this._radarKey = key;
      const wasPlaying = this._playing;
      this._stop();
      e.frames.replaceChildren();
      this._frames = full ? frames : frames.filter((f) => f.kind === "now");
      this._layers = new Array(this._frames.length);
      this._tl = tl;
      // each tile source at its own data zoom: past its zmax the tiles are upscaled (smoothly)
      this._tileCtx = {
        srcs: tl.srcs.map((src) => {
          const dataZ = layerZoom(viewZ, src);
          return { template: src.template, dataZ, tiles: gridTiles(lat, lon, viewZ, dataZ, this._width, h) };
        }),
      };
      const nowIdx = Math.max(0, this._frames.findIndex((f) => f.kind === "now"));
      if (full) {
        e.scrub.max = String(Math.max(0, this._frames.length - 1));
        const m = scrubMarks(this._frames);
        e.snow.hidden = this._frames.length < 2;
        e.snow.style.left = `${m.now * 100}%`;
        e.sfc.hidden = m.fcFrom == null;
        if (m.fcFrom != null) e.sfc.style.left = `${m.fcFrom * 100}%`;
      }
      // Only the frame on screen is built. Play (or the scrubber) builds the others; a basetime
      // change while paused rebuilds this one layer, not 24.
      this._show(nowIdx);
      if (wasPlaying) this._play();
    }

    /** Chips for the layers that have data; the shown one marked; its legend; no scrubber when static. */
    _renderLayerControls(avail, layerId, sub, tl, L) {
      const e = this._el;
      for (const d of LAYER_DEFS) {
        const b = this._chipBtns[d.id];
        b.hidden = !avail.includes(d.id);
        b.classList.toggle("on", d.id === layerId);
        b.setAttribute("aria-pressed", String(d.id === layerId));
      }
      // an older backend (no `layers`): no chip row at all
      e.lchips.parentElement.hidden = avail.length < 2;
      e.lsubs.hidden = layerId !== "risk";
      for (const r of RISK_SUBS) {
        const b = this._subBtns[r.id];
        b.hidden = !layerUsable(L, r.key);
        b.classList.toggle("on", layerId === "risk" && r.id === sub);
        b.setAttribute("aria-pressed", String(layerId === "risk" && r.id === sub));
      }
      const lg = layerId === "rasrf" ? "rain" : layerId;
      for (const l of e.legends) l.hidden = l.dataset.l !== lg;
      if (layerId === "risk") {
        e.lrt.textContent = { inund: "キキクル 浸水害", land: "キキクル 土砂災害", flood: "キキクル 洪水害" }[sub];
        e.lk1.style.background = kikikuruColour(1, sub)[0];
      }
      // the GSI layer's own attribution (from the sensor), under its legend
      if (layerId === "flood") e.lat.textContent = (tl.srcs[0] && tl.srcs[0].attribution) || "";
      e.play.hidden = !!tl.static;
      e.scrubwrap.hidden = !!tl.static;
    }

    /** Region and Japan presets: each storm's past track, forecast track and forecast circles over the map. */
    _renderTyphoonTrack(lat, lon, viewZ, h, baseKey) {
      const svg = this._el.tyo;
      if (!svg) return;
      const show = this._spanKm() >= TY_MIN_SPAN_KM;
      const st = this._st("typhoon");
      const a = show ? liveAttrs(st) : null;
      const storms = a && Array.isArray(a.storms) ? a.storms : [];
      const key = `${baseKey}|${show}`;
      if (key === this._tyKey && (storms === this._tyStorms || (!storms.length && !this._tyStorms.length))) return;
      this._tyKey = key;
      this._tyStorms = storms;
      svg.replaceChildren();
      if (!storms.length) { svg.setAttribute("hidden", ""); return; }
      svg.removeAttribute("hidden");
      const w = this._width;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      const NS = "http://www.w3.org/2000/svg";
      const mk = (tag, cls, at) => {
        const n = document.createElementNS(NS, tag);
        n.setAttribute("class", cls);
        for (const [k, v] of Object.entries(at)) n.setAttribute(k, String(v));
        return n;
      };
      const f = (v) => v.toFixed(1);
      const pts = (arr) => arr.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
      for (const storm of storms) {
        const g = typhoonGeometry(storm, lat, lon, viewZ, w, h, this._tz);
        for (const c of g.circles) svg.appendChild(mk("circle", "tc", { cx: f(c.x), cy: f(c.y), r: f(c.r) }));
        if (g.past.length > 1) svg.appendChild(mk("polyline", "tp", { points: pts(g.past) }));
        if (g.track.length > 1) svg.appendChild(mk("polyline", "tf", { points: pts(g.track) }));
        for (const [x, y] of g.track.slice(g.now ? 1 : 0)) svg.appendChild(mk("circle", "td", { cx: f(x), cy: f(y), r: 3.5 }));
        // the forecast times at the centres in view (JMA's map does the same)
        for (const l of g.labels) {
          if (l.x < 0 || l.y < 0 || l.x > w || l.y > h) continue;
          const t = mk("text", "tt", { x: f(l.x + 7), y: f(l.y - 6) });
          t.textContent = l.text;
          svg.appendChild(t);
        }
        if (g.now) {
          svg.appendChild(mk("circle", "tn", { cx: f(g.now[0]), cy: f(g.now[1]), r: 6 }));
          const label = mk("text", "tl", { x: f(g.now[0] + 10), y: f(g.now[1] + 4) });
          label.textContent = typhoonNumber(storm) || storm.name_ja || "";
          svg.appendChild(label);
        }
      }
    }

    /** The layer of frame i, built on first use. */
    _layer(i) {
      if (this._layers[i]) return this._layers[i];
      const f = this._frames[i];
      const ctx = this._tileCtx;
      const layer = el("div", `layer ${f.kind}`);
      // parts in order: 雷 draws thns, then trns on top
      for (const part of f.parts || []) {
        const src = ctx.srcs[part.src];
        if (!src) continue;
        for (const t of src.tiles) {
          const img = el("img");
          let member = part.frame.member;
          const ownUrl = fillTemplate(src.template, part.frame, src.dataZ, t.x, t.y);
          let retried = false;
          img.addEventListener("error", () => {
            // a renamed キキクル frame: the next member name, else give the tile up
            member = retried ? null : nextMember(member);
            if (member) img.src = fillTemplate(src.template, { ...part.frame, member }, src.dataZ, t.x, t.y);
            else {
              img.style.visibility = "hidden";
              if (retried) return;  // the second try failed too: given up (already counted)
              layer._failed = true;
              layer._failedTiles = (layer._failedTiles || 0) + 1;
              if (this._frameIdx === i) this._el.stamp.textContent = "Couldn't load the layer pictures · last frame incomplete";
              // J5: the frame's own tile is asked once more after TILE_RETRY_MS; shown again if it loads
              retried = true;
              retryTileOnce(img, ownUrl, () => {
                img.style.visibility = "";
                layer._failedTiles -= 1;
                layer._failed = layer._failedTiles > 0;
                if (!layer._failed && this._layers[i] === layer && this._frameIdx === i) this._show(i);
              });
            }
          });
          this._place(img, t);
          img.src = ownUrl;
          layer.appendChild(img);
        }
      }
      this._el.frames.appendChild(layer);
      this._layers[i] = layer;
      return layer;
    }

    _place(img, t) {
      // whole pixels on both edges: fractional positions leave hairline seams between tiles
      const left = Math.round(t.left);
      const top = Math.round(t.top);
      img.style.left = `${left}px`;
      img.style.top = `${top}px`;
      img.style.width = `${Math.round(t.left + t.size) - left}px`;
      img.style.height = `${Math.round(t.top + t.size) - top}px`;
      img.alt = "";
      img.decoding = "async";
    }

    /** km across the map's width for the chosen preset (full); 0 on the compact card. */
    _spanKm() {
      const spans = Array.isArray(this._config.spans) ? this._config.spans : [];
      return this._full && spans.length ? num(spans[Math.min(this._zoomIdx, spans.length - 1)]) || 0 : 0;
    }

    /** Japan preset: the chosen day's forecast at each city JMA issues one for, over the map. */
    _renderCities() {
      const box = this._el.cities;
      const v = this._view;
      if (!box || !v) return;
      const a = this._spanKm() >= JAPAN_MIN_SPAN_KM ? liveAttrs(this._st("japan")) : null;
      const cities = a && Array.isArray(a.cities) ? a.cities : [];
      const date = cities.length ? (this._jpDate || japanDay(cities, Date.now())) : null;
      const unit = tempUnit(liveAttrs(this._st("entity")));
      const key = `${v.baseKey}|${date}|${unit}|${a ? a.report_time || cities.length : ""}`;
      if (key === this._cityKey) return;
      this._cityKey = key;
      box.replaceChildren();
      box.hidden = !date;
      if (!date) return;
      for (const m of cityMarks(cities, date, v.lat, v.lon, v.viewZ, v.w, v.h)) {
        const mark = el("div", "city");
        mark.style.left = `${Math.round(m.x)}px`;
        mark.style.top = `${Math.round(m.y)}px`;
        if (/^[\w.-]+\.svg$/.test(m.icon)) {
          const img = el("img");
          img.src = `${JMA_ICON}${m.icon}`;
          img.alt = "";
          mark.appendChild(img);
        }
        mark.appendChild(el("b", "", m.temp == null ? "" : `${Math.round(toUnit(m.temp, unit))}°`));
        mark.appendChild(el("span", "", m.name));
        box.appendChild(mark);
      }
    }

    /**
     * One strike file, fetched once and kept: its strikes ([] = the file held none). A failure (HTTP
     * error, network error, bad JSON, no answer in 8 s) is not kept as "no strikes": it resolves to
     * null and the file is asked for again after 60 s.
     */
    _lidenLoad(url) {
      const have = this._liden.get(url);
      if (have && !have.failedAt) return have;
      if (have && Date.now() - have.failedAt < LIDEN_RETRY_MS) return Promise.resolve(null);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), LIDEN_TIMEOUT_MS);
      const job = fetch(url, { mode: "cors", credentials: "omit", signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        // a body with no features list is a failed read, not "no strikes"
        .then((j) => (j && Array.isArray(j.features) ? lidenPoints(j) : Promise.reject(new Error("no features list"))))
        .then((pts) => { clearTimeout(timer); this._liden.set(url, pts); return pts; },
          () => { clearTimeout(timer); this._liden.set(url, { failedAt: Date.now() }); return null; });
      this._liden.set(url, job);
      while (this._liden.size > LIDEN_KEEP) this._liden.delete(this._liden.keys().next().value);
      return job;
    }

    /**
     * Strikes over the frame on screen. Full page, 雨 and 雷 layers: JMA's LIDEN files for the frame's
     * own minutes, and Blitzortung for anything newer than the newest of them. Compact: Blitzortung
     * only (no request leaves the browser for it).
     */
    _renderBolts() {
      const cv = this._el && this._el.bolts;
      const v = this._view;
      if (!cv) return;
      const f = this._frames[this._frameIdx];
      const on = !!v && !!f && (v.layerId === "rain" || v.layerId === "thunder") && f.kind !== "forecast";
      const token = (this._boltToken = (this._boltToken || 0) + 1);
      if (!on) { this._paintBolts([], 0, 0); this._boltNote(null); return; }
      const end = (parseJmaTime(f.validtime) || new Date()).getTime();
      const step = v.layerId === "thunder" ? 10 : 5;
      const s = this._st("frames");
      const layer = this._full && liveAttrs(s) && s.attributes.layers ? s.attributes.layers.liden : null;
      const files = layer ? lidenFramesFor(f, layer.frames, step).map((g) => lidenUrl(layer, g)).filter(Boolean) : [];
      const newestFile = layer && Array.isArray(layer.frames) && layer.frames.length
        ? (parseJmaTime(layer.frames[layer.frames.length - 1].validtime) || new Date(0)).getTime() : 0;
      const now = Date.now();
      const mins = this._config.lightning.minutes;
      // Blitzortung: on the newest observed frame, what JMA's files do not hold yet
      const blitz = f.kind === "now"
        ? strikesBetween(this._blitzNow(), Math.max(newestFile, now - mins * 60000), now, false) : [];
      const from = Math.min(end - step * 60000, now - (f.kind === "now" ? mins : 0) * 60000);
      // loaded = every strike file of this frame has answered; a file still loading or failed is not "none"
      const draw = (jma, loaded) => {
        if (token !== this._boltToken) return;
        const pts = jma.concat(blitz);
        this._paintBolts(pts, from, Math.max(end, now));
        this._boltNote(v.layerId === "thunder" || pts.length ? strikeSummary(pts, [v.lat, v.lon]) : null,
          Math.max(step, Math.round((Math.max(end, f.kind === "now" ? now : end) - from) / 60000)), loaded && files.length > 0);
      };
      const ready = files.map((u) => this._liden.get(u));
      if (ready.every((r) => Array.isArray(r))) { draw([].concat(...ready), true); return; }
      draw([].concat(...ready.filter((r) => Array.isArray(r))), false);
      Promise.all(files.map((u) => this._lidenLoad(u))).then((all) => draw([].concat(...all.filter((r) => Array.isArray(r))),
        all.every((r) => Array.isArray(r))));
    }

    /** Compact strike line: the strikes of the last lightning minutes and home, for topBlock. */
    _strikeInput() {
      if (this._full) return {};
      const now = Date.now();
      const mins = this._config.lightning.minutes;
      const fr = liveAttrs(this._st("frames"));
      return { strikes: strikesBetween(this._blitzNow(), now - mins * 60000, now, false),
        home: homeLatLon(this._config.home, fr && fr.home, this._hass.config) };
    }

    /** The Blitzortung strike entities, re-read only when the counter or the entity set moved. */
    _blitzNow() {
      const c = this._st("lightning_counter");
      const states = this._hass.states;
      if (!c) return [];
      const key = `${c.state}|${c.last_updated}`;
      if (key !== this._blitzKey) {
        this._blitzKey = key;
        this._blitz = blitzStrikes(states, this._config.lightning.source);
      }
      return this._blitz;
    }

    /** Draw strikes on the canvas: ground strikes (and Blitzortung's) as diamonds, cloud ones as rings; older = fainter. */
    _paintBolts(points, fromMs, toMs) {
      const cv = this._el.bolts;
      const v = this._view;
      const w = (v && v.w) || 0;
      const h = (v && v.h) || 0;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      cv.hidden = !points.length;
      if (!points.length || !v) return;
      const span = Math.max(1, toMs - fromMs);
      // oldest first, so the newest strike is on top
      const sorted = points.slice().sort((a, b) => (a.t || 0) - (b.t || 0));
      for (const p of sorted) {
        const [x, y] = projectPoint(p.lat, p.lon, v.lat, v.lon, v.viewZ, w, h);
        if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
        const age = p.t == null ? 0.5 : Math.max(0, Math.min(1, (toMs - p.t) / span));
        g.globalAlpha = 1 - 0.55 * age;
        g.lineWidth = 1.5;
        g.strokeStyle = "#111";
        g.fillStyle = "#fff";
        g.beginPath();
        if (p.cg === false) {
          g.arc(x, y, 3, 0, 2 * Math.PI);
          g.lineWidth = 3; g.strokeStyle = "#fff"; g.stroke();
          g.lineWidth = 1.5; g.strokeStyle = "#111"; g.stroke();
        } else {
          g.moveTo(x, y - 5.5); g.lineTo(x + 4, y); g.lineTo(x, y + 5.5); g.lineTo(x - 4, y); g.closePath();
          g.fill(); g.stroke();
        }
      }
      g.globalAlpha = 1;
    }

    /** The line under the layer chips: strikes in the frame's minutes, nearest to home. "None" only once the files loaded. */
    _boltNote(summary, minutes, loaded) {
      const n = this._el.lnote;
      if (!n) return;
      const thunder = !!this._view && this._view.layerId === "thunder";
      const text = summary ? strikeLine(summary, minutes) : (thunder && loaded ? "落雷 none in these minutes" : "");
      n.textContent = text;
      n.hidden = !text;
    }

    /** Full page: the nationwide table (JMA's forecast for each office's city), one day at a time. */
    _renderJapan() {
      const e = this._el;
      if (!e.japan) return;
      const a = liveAttrs(this._st("japan"));
      const cities = a && Array.isArray(a.cities) ? a.cities : [];
      e.japan.hidden = !cities.length;
      if (!cities.length) return;
      const tz = this._tz;
      const unit = tempUnit(liveAttrs(this._st("entity")));
      const auto = japanDay(cities, Date.now());
      const dates = [...new Set(cities.flatMap((c) => (c.days || []).filter((d) => d && d.code).map((d) => d.date)))].sort();
      if (!dates.includes(this._jpDate)) this._jpDate = "";
      const date = this._jpDate || auto;
      const today = dayKey(new Date(), JST);   // the cities' dates are Japan's days
      // the sensor's state is JMA's newest report time
      const issued = toDate(a.report_time) || toDate(this._st("japan").state);
      e.jpsub.textContent = `Japan · JMA ${issued ? `${fmtTime(issued, tz)} issue` : "forecast"}`;
      e.jpdays.replaceChildren();
      for (const d of dates) {
        const b = el("button", `jpd${d === date ? " on" : ""}`, japanDayLabel(d, today));
        b.type = "button";
        b.setAttribute("aria-pressed", String(d === date));
        b.addEventListener("click", () => { this._jpDate = d; this._cityKey = ""; this._renderJapan(); this._renderCities(); });
        e.jpdays.appendChild(b);
      }
      e.jplist.replaceChildren();
      for (const c of cities) {
        const d = cityDay(c, date);
        if (!d) continue;
        const row = el("div", "jp");
        row.appendChild(el("span", "jpn", c.name));
        row.appendChild(el("span", "jpe", c.name_en || ""));
        const img = el("img");
        if (/^[\w.-]+\.svg$/.test(d.icon || "")) img.src = `${JMA_ICON}${d.icon}`;
        img.alt = "";
        img.loading = "lazy";
        row.appendChild(img);
        row.appendChild(el("span", "jpt", d.text || ""));
        row.appendChild(el("span", `jpp${num(d.pop) === 0 ? " zero" : ""}`, num(d.pop) == null ? "\u2014" : `${num(d.pop)}%`));
        row.appendChild(el("span", "jpl", num(d.temp_min) == null ? "\u2014" : `${Math.round(toUnit(d.temp_min, unit))}°`));
        const hi = el("span", "jph", num(d.temp_max) == null ? "\u2014" : `${Math.round(toUnit(d.temp_max, unit))}°`);
        if (num(d.temp_max) != null) hi.style.setProperty("--tc", tempColour(num(d.temp_max)));  // a bar in CSS, the figure stays ink
        row.appendChild(hi);
        e.jplist.appendChild(row);
      }
      // pass 4: the first JP_ROWS cities and a text button for the rest
      const JP_ROWS = 10;
      const all = Array.from(e.jplist.children);
      const over = all.length > JP_ROWS;
      if (over && !this._jpAll) all.slice(JP_ROWS).forEach((r) => r.remove());
      e.jpmore.hidden = !over;
      e.jpmore.textContent = this._jpAll ? "Show fewer" : `Show all ${all.length}`;
      e.jpmore.setAttribute("aria-expanded", String(!!this._jpAll));
    }

    _show(i) {
      if (!this._frames.length || !this._tileCtx) { this._el.stamp.textContent = ""; this._renderBolts(); return; }
      this._frameIdx = Math.max(0, Math.min(this._frames.length - 1, i));
      const cur = this._layer(this._frameIdx);
      for (const l of this._layers) if (l) l.style.visibility = l === cur ? "visible" : "hidden";
      const f = this._frames[this._frameIdx];
      this._el.stamp.textContent = cur._failed ? "Couldn't load the layer pictures · last frame incomplete" : layerStamp(f, this._tl, this._tz, Date.now());
      this._el.stamp.classList.toggle("fc", f.kind === "forecast");
      if (this._el.scrub) this._el.scrub.value = String(this._frameIdx);
      this._renderBolts();
    }

    async _play() {
      if (!this._frames.length || (this._tl && this._tl.static)) return;
      // under reduced motion the loop does not start at all
      if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      this._playing = true;
      const token = ++this._playToken;
      const play = this._el.play;
      play.textContent = "❚❚";
      play.setAttribute("aria-label", "Pause");
      // build every frame and wait until its tiles have decoded (a timeout covers a slow or dead tile)
      const imgs = [];
      for (let i = 0; i < this._frames.length; i++) imgs.push(...this._layer(i).querySelectorAll("img"));
      play.classList.add("busy");
      await Promise.race([
        Promise.allSettled(imgs.map((img) => (img.decode ? img.decode() : Promise.resolve()))),
        new Promise((resolve) => { setTimeout(resolve, DECODE_TIMEOUT_MS); }),
      ]);
      if (!this._playing || token !== this._playToken) return;
      play.classList.remove("busy");
      let passes = 0;
      const tick = () => {
        if (!this._playing || token !== this._playToken) return;
        const next = (this._frameIdx + 1) % this._frames.length;
        // after 3 full passes (3 wraps) the loop stops and rests on the "now" frame
        if (next === 0 && ++passes >= 3) {
          this._stop();
          this._show(Math.max(0, this._frames.findIndex((f) => f.kind === "now")));
          return;
        }
        this._show(next);
        const hold = this._frames[next].kind === "now" || next === this._frames.length - 1 ? 1500 : 500;
        this._timer = setTimeout(tick, hold);
      };
      this._timer = setTimeout(tick, 300);
    }

    _stop() {
      this._playing = false;
      this._playToken += 1;
      clearTimeout(this._timer);
      if (this._el && this._el.play) {
        this._el.play.textContent = "▶";
        this._el.play.setAttribute("aria-label", "Play");
        this._el.play.classList.remove("busy");
      }
    }

    // ---------------------------------------------------------------- the drop-down sections

    _warningsInForce() {
      const s = this._st("warnings");
      return ((s && s.attributes.warnings) || []).length > 0;
    }

    _renderTabs() {
      if (this._full || !this._el.tabs) return;
      // the buttons exist once (built in _build); only their state changes here
      const inForce = this._warningsInForce();
      if (!TABS.some((t) => t.id === this._tab) || (this._tab === "warnings" && !inForce)) this._tab = "hourly";
      for (const t of TABS) {
        const b = this._tabBtns[t.id];
        b.hidden = t.id === "warnings" && !inForce;
        b.classList.toggle("on", t.id === this._tab);
        b.setAttribute("aria-selected", String(t.id === this._tab));
      }
      for (const sec of this._el.more.querySelectorAll("section[data-tab]")) {
        sec.classList.toggle("off", sec.dataset.tab !== this._tab);
      }
    }

    _renderWarnings() {
      const s = this._st("warnings");
      const e = this._el;
      e.wlist.replaceChildren();
      const unav = !s || s.state === "unavailable" || s.state === "unknown";
      const a = (!unav && s.attributes) || {};
      const list = a.warnings || [];
      // compact: the section only exists while something is in force (the chips already say so)
      e.warnings.hidden = !this._full && !list.length;
      e.warnings.classList.toggle("stale", unav);
      if (unav) {
        e.wlist.appendChild(el("div", "muted", "Couldn't reach the warnings feed"));
      } else if (!list.length) {
        e.wlist.appendChild(stateRow("mdi:check-circle-outline", `${a.area_name || ""}: 発表中の警報・注意報はありません · none in force`));
      }
      for (const w of list) {
        const row = el("div", "wrow");
        // a dot in JMA's level colour + the name in ink; the filled chip is drawn once, in the top block
        const { bg } = chipColours(LEVEL_COLOURS[num(w.level) || 0]);
        const dot = el("span", "wdot");
        dot.style.background = bg;
        const pill = el("span", "wname", pillText(w).text);
        const when = w.report_time ? ` · ${fmtTime(new Date(w.report_time), this._tz)}` : "";
        row.append(dot, pill, el("span", "wen", `${w.name_en} · ${w.status}${when}`));
        e.wlist.appendChild(row);
      }
      e.headline.textContent = list.length ? a.headline || "" : "";
      // only ever a link to JMA over https
      const url = safeJmaUrl(a.jma_url);
      if (url) e.jma.href = url; else e.jma.removeAttribute("href");
      e.jma.hidden = !url;
      this._renderKikikuru(a.area_name);
      this._renderOutlookStrip();
    }

    /** 「キキクル(the ward) 浸水 0 · 土砂 0 · 洪水 0」, the legend's word (and colour) from level 1. */
    _renderKikikuru(areaName) {
      const e = this._el;
      const st = this._st("kikikuru");
      e.kiki.hidden = !st;
      if (!st) return;
      const a = liveAttrs(st);
      e.kikiT.textContent = areaName ? `キキクル(${areaName})` : "キキクル";
      e.kiki.classList.toggle("stale", !a);
      e.kikiV.replaceChildren();
      if (!a) { e.kikiV.appendChild(el("span", "", "No data")); return; }
      kikikuruParts(a).forEach((p, i) => {
        if (i) e.kikiV.appendChild(el("span", "sep", "·"));
        const s = el("span", "kp");
        if (p.level != null && p.level >= 1) {
          const sw = el("i");
          sw.style.background = kikikuruColour(p.level, p.element)[0];
          s.appendChild(sw);
        }
        s.appendChild(document.createTextNode(p.text));
        e.kikiV.appendChild(s);
      });
      const t = parseJmaTime(a.basetime);
      e.kiki.title = t ? `JMA キキクル at home · ${fmtTime(t, this._tz)}` : "JMA キキクル at home";
    }

    /** 今後24時間: 8 three-hour cells in the warning-level colours, phenomena from L2, max 1-h rain. */
    _renderOutlookStrip() {
      const e = this._el;
      const st = this._st("outlook");
      e.ol.hidden = !st;
      if (!st) return;
      const a = liveAttrs(st);
      const cells = a ? outlookCells(a, this._tz, Date.now()) : [];
      e.ol.classList.toggle("stale", !a);
      e.olcells.replaceChildren();
      e.olcells.hidden = !cells.length;
      e.ol.classList.toggle("nolv", !cells.some((c) => c.level >= 2));
      // the unit stays on screen when no cell carries a level: the key then says only what the figures are
      const okey = e.ol.querySelector(".olkey");
      if (okey) okey.textContent = e.ol.classList.contains("nolv") ? "mm = max 1-h rain" : "colour = warning level JMA expects \u00b7 mm = max 1-h rain";
      e.olnote.hidden = !!cells.length;
      e.olnote.textContent = cells.length ? "" : a ? "No 3-hourly outlook" : "No data";
      for (const c of cells) {
        const cell = el("div", `olc${c.level >= 2 ? " lv" : ""}${c.newDay ? " nd" : ""}`);
        if (c.level >= 2) {
          const { bg, fg } = chipColours(levelColour(c.level));  // ink on JMA red, as the chips
          cell.style.background = bg;
          cell.style.color = fg;
        }
        cell.title = c.title;
        const ph = el("span", "op");
        for (const p of c.phen) ph.appendChild(el("span", "", p));
        cell.append(el("span", "oh", c.label), ph, el("span", "or", c.rain == null ? "\u2014" : `${c.rain}`));
        e.olcells.appendChild(cell);
      }
    }

    /** Full page: one block per storm (name, category, now, closest approach). */
    _renderTyphoon() {
      const e = this._el;
      if (!e.typhoon) return;
      const a = liveAttrs(this._st("typhoon"));
      const storms = a && Array.isArray(a.storms) ? a.storms : [];
      e.typhoon.hidden = !storms.length;
      e.tylist.replaceChildren();
      for (const storm of storms) {
        const t = typhoonLines(storm, this._tz);
        if (!t) continue;
        const box = el("div", "storm");
        const head = el("div", "sh");
        const nameB = el("b", "");
        const nm = /^(.*?)\s*(\([^)]*\))$/.exec(t.title);
        if (nm) nameB.append(`${nm[1]} `, el("span", "nwr", nm[2])); else nameB.textContent = t.title;   // "(Choi-wan)" never breaks at its hyphen
        head.append(nameB, el("span", "ss", nbUnit(t.sub)));
        box.appendChild(head);
        if (t.now) box.appendChild(el("div", "sr", nbUnit(t.now)));
        if (t.closest) box.appendChild(el("div", "sr sc", nbUnit(t.closest)));
        e.tylist.appendChild(box);
      }
    }

    _renderHourly() {
      const e = this._el;
      const tz = this._tz;
      const nowMs = Date.now();
      // from the current hour on: a row whose hour has gone is dropped, never labelled "Now"
      const rows = hourlyRows(liveAttrs(this._st("entity")) ? this._hourly : null, nowMs, tz, this._config.hours);
      e.hstrip.replaceChildren();
      this._shown.hourly = rows.length > 0;
      if (!rows.length) {
        e.hstrip.appendChild(this._subFailedAt.hourly ? el("div", "muted", "Couldn't reach the hourly forecast")
          : this._hourly && !(this._fcAwait.hourly && liveAttrs(this._st("entity"))) ? (liveAttrs(this._st("entity")) ? stateRow("mdi:check-circle-outline", "No hourly forecast from this hour on") : el("div", "muted", "No hourly forecast from this hour on"))
          : stateRow("mdi:timer-sand", "Hourly forecast loading…"));
        e.hkey.hidden = true;
        return;
      }
      const sun = this._st("sun");
      const sa = (sun && sun.attributes) || {};
      const cur = hourStart(nowMs, tz);
      const pUnit = (liveAttrs(this._st("entity")) || {}).precipitation_unit || "mm";
      const cloud = this._full && rows.some((r) => r.cloud_coverage != null && Number.isFinite(+r.cloud_coverage));
      rows.forEach((r) => {
        const t = new Date(r.datetime);
        const isCur = t.getTime() === cur;
        const col = el("div", `hcol${isCur ? " cur" : ""}`);
        col.appendChild(el("div", "hh", isCur ? "Now" : fmtHour(t, tz)));
        const img = el("img");
        // night for the icon: HA's condition already says clear-night; for the rest use the sun times
        const night = r.condition === "clear-night" || isNight(t, sa.next_rising, sa.next_setting);
        img.src = JMA_ICON + conditionIcon(r.condition, night);
        img.alt = r.condition || "";
        col.appendChild(img);
        const temp = el("div", "ht", r.temperature == null ? "\u2014" : `${Math.round(r.temperature)}°`);
        col.appendChild(temp);
        // a missing amount is "\u2014", never blank; only a real 0 to 0.09 stays blank
        const mmKnown = r.precipitation != null && Number.isFinite(+r.precipitation);
        const mm = mmKnown ? +r.precipitation : 0;
        col.appendChild(el("div", `hp${mm >= 0.5 ? " wet" : ""}`, !mmKnown ? "\u2014" : mm >= 0.1 ? `${mm < 1 ? mm.toFixed(1) : Math.round(mm)}\u00a0${pUnit}` : ""));
        if (cloud) {
          const c = r.cloud_coverage != null && Number.isFinite(+r.cloud_coverage) ? `${Math.round(+r.cloud_coverage)}%` : "\u2014";
          col.appendChild(el("div", "hc", c));
        }
        e.hstrip.appendChild(col);
      });
      e.hkey.hidden = !cloud;
      e.hstrip.scrollLeft = this._hScroll;
    }

    _renderPops() {
      const w = this._st("entity");
      const e = this._el;
      e.pops.replaceChildren();
      // finished slots dropped; nothing is dimmed for being tomorrow (it says the weekday instead)
      const slots = popSlots((w && w.attributes && w.attributes.pops_6h) || [], Date.now(), this._tz);
      for (const p of slots) {
        const box = el("div", `pop${p.current ? " cur" : ""}`);
        box.appendChild(el("span", "pt", p.label));
        const v = el("b", "", p.pop == null ? "\u2014" : `${p.pop}%`);
        box.appendChild(v);
        const meter = el("i");
        meter.style.width = `${p.pop || 0}%`;
        meter.hidden = p.pop == null;
        box.appendChild(meter);
        e.pops.appendChild(box);
      }
      e.pops.parentElement.hidden = !slots.length;
    }

    _renderWeek() {
      const e = this._el;
      const tz = this._tz;
      e.days.replaceChildren();
      // rows whose date does not parse are skipped (Intl would throw a RangeError on them)
      const days = (liveAttrs(this._st("entity")) ? this._daily || [] : []).filter((d) => d && toDate(d.datetime)).slice(0, 8);
      if (!days.length) {
        e.days.appendChild(this._subFailedAt.daily ? el("div", "muted", "Couldn't reach the 7-day forecast")
          : this._daily && !this._fcAwait.daily && liveAttrs(this._st("entity")) ? stateRow("mdi:check-circle-outline", "No 7-day forecast to show") : stateRow("mdi:timer-sand", "7-day forecast loading…"));
        e.wkey.hidden = true;
        return;
      }
      const num = (v) => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);
      const w = this._st("entity");
      const a = (w && w.state !== "unavailable" && w.state !== "unknown" && w.attributes) || {};
      const nowT = num(a.temperature);
      const unit = tempUnit(a);
      const cv = (v) => toUnit(v, unit);   // ha-jma's extra attributes are Celsius; the entity's temperature is already in its unit
      const obsLo = cv(a.temp_min_observed);
      const obsHi = cv(a.temp_max_observed);
      const normLo = cv(a.normal_temp_min);
      const normHi = cv(a.normal_temp_max);
      const hasNorm = normLo != null && normHi != null;
      // the scale holds everything drawn: forecasts, JMA's ranges, today's observations, the normals
      const temps = days.flatMap((d) => [d.templow, d.temperature, cv(d.temp_min_lower), cv(d.temp_min_upper),
        cv(d.temp_max_lower), cv(d.temp_max_upper)]).concat([nowT, obsLo, obsHi, hasNorm ? normLo : null, hasNorm ? normHi : null])
        .map(num).filter((t) => t != null);
      const wmin = Math.min(...temps);
      const wmax = Math.max(...temps);
      const pct = (t) => Math.max(0, Math.min(100, ((t - wmin) / Math.max(1, wmax - wmin)) * 100));
      const deg = (v) => `${Math.round(v)}°`;
      const today = dayKey(new Date(), tz);
      const station = a.station_primary_name || a.station_primary || "";
      let usedObs = false;
      let usedRange = false;
      days.forEach((d) => {
        const t0 = toDate(d.datetime);
        const isToday = dayKey(t0, tz) === today;
        const row = el("div", "day");
        const when = fmtDay(t0, tz);
        const name = el("span", "dname", isToday ? "今日" : when.ja);
        name.title = when.full;
        const date = el("span", "ddate", when.jmd);
        const img = el("img");
        img.alt = d.condition || "";
        if (d.jma_icon) img.src = JMA_ICON + d.jma_icon;
        const pop = el("span", "dpop", num(d.precipitation_probability) == null ? "\u2014" : `${num(d.precipitation_probability)}%`);
        const fLo = num(d.templow);
        const fHi = num(d.temperature);
        // today with no forecast temps (JMA never gives today's low; 17:00 drops the high): the
        // AMeDAS low/high so far, drawn hollow so it cannot pass for a forecast
        const obs = isToday && fLo == null && fHi == null;
        const loV = obs ? obsLo : fLo;
        const hiV = obs ? obsHi : fHi;
        const lo = el("span", `dlo${obs ? " obs" : ""}`, loV == null ? "\u2014" : deg(loV));
        const hi = el("span", `dhi${obs ? " obs" : ""}`, hiV == null ? "\u2014" : deg(hiV));
        if (obs) {
          const at = (v) => { const t = toDate(v); return t ? ` at ${fmtTime(t, tz)}` : ""; };
          lo.title = `observed low so far${at(a.temp_min_observed_time)}${station ? ` · AMeDAS ${station}` : ""}`;
          hi.title = `observed high so far${at(a.temp_max_observed_time)}${station ? ` · AMeDAS ${station}` : ""}`;
        }
        const track = el("span", "track");
        if (hasNorm) {
          const n = el("span", "norm");
          const n0 = pct(Math.min(normLo, normHi));
          n.style.left = `${n0}%`;
          n.style.width = `${pct(Math.max(normLo, normHi)) - n0}%`;
          n.title = `平年 normal ${deg(normLo)}–${deg(normHi)}`;
          track.appendChild(n);
        }
        for (const [lower, upper] of [[d.temp_min_lower, d.temp_min_upper], [d.temp_max_lower, d.temp_max_upper]]) {
          const l = cv(lower);
          const u = cv(upper);
          if (l == null || u == null) continue;
          const wh = el("span", "wh");
          const w0 = pct(Math.min(l, u));
          wh.style.left = `${w0}%`;
          wh.style.width = `${Math.max(pct(Math.max(l, u)) - w0, 0.5)}%`;
          wh.title = `JMA range ${deg(Math.min(l, u))}–${deg(Math.max(l, u))}`;
          track.appendChild(wh);
          usedRange = true;
        }
        const r = rangeBar(loV, hiV, wmin, wmax);
        if (r) {
          const bar = el("i", obs ? "obs" : "");
          bar.style.left = `${r.left}%`;
          bar.style.width = `${r.width}%`;
          // one solid fill (CSS .track i): the printed lows and highs carry the values
          if (obs) usedObs = true;
          track.appendChild(bar);
        }
        if (isToday && nowT != null) {
          const dot = el("b");
          dot.style.left = `${pct(nowT)}%`;
          dot.title = `now ${nowT}°`;
          track.appendChild(dot);
        }
        const rel = el("span", "drel", d.reliability || "");
        if (d.reliability) rel.title = "JMA confidence: A high · B · C low";
        row.append(name, date, img, pop, lo, track, hi, rel);
        e.days.appendChild(row);
      });
      const key = [];
      if (usedObs) key.push("今日 outlined = observed so far");
      if (usedRange) key.push("thin lines = JMA's range");
      if (hasNorm) key.push(`shaded = 平年 normal ${deg(normLo)}–${deg(normHi)}`);
      if ((this._daily || []).some((d) => d && d.reliability)) key.push("A–C = JMA's confidence, A highest");
      e.wkey.textContent = key.join(" · ");
      e.wkey.hidden = !key.length;
    }

    _renderDetails() {
      const e = this._el;
      const w = this._st("entity");
      const a = (w && w.attributes) || {};
      const sun = this._st("sun");
      const tz = this._tz;
      const tiles = [];
      const add = (label, value, note) => { if (value != null && value !== "") tiles.push([label, value, note]); };
      const station = a.station_primary_name || a.station_primary || "";
      // the station is named once, in the Observed row under the tiles (keeps the labels to one line)
      const at = (label) => label;
      add("Humidity", a.humidity != null ? `${a.humidity}%` : null);
      // 環境省 暑さ指数 (WBGT): today's forecast max; hidden while the sensor is unavailable (out of season)
      const wbSt = this._st("wbgt");
      const wbV = liveAttrs(wbSt) ? num(wbSt.state) : null;
      const wbBand = wbgtBand(wbV);
      if (wbBand) tiles.push(["暑さ指数 WBGT", `${wbV.toFixed(1)}\u00a0°C`, "today max", wbBand]);
      add("Pressure", a.pressure != null ? `${Math.round(a.pressure)} ${a.pressure_unit || "hPa"}` : null);
      add("Wind", a.wind_speed != null ? `${Number(a.wind_speed).toFixed(1)} ${a.wind_speed_unit || ""}`.trim() : null, compass(a.wind_bearing));
      // AMeDAS gives the day's MAXIMUM gust (with its time), not a current gust
      const gust = gustInUnit(a.gust_max_today, a.wind_speed_unit);
      if (gust) {
        const gt = toDate(a.gust_max_time);
        add("Peak gust", `${gust.value.toFixed(1)} ${gust.unit}`, gt ? `today ${fmtTime(gt, tz)}` : "today");
      } else if (a.wind_gust_speed != null) {
        // an older entity: the same day-max number, already in the entity's unit
        add("Peak gust", `${Number(a.wind_gust_speed).toFixed(1)} ${a.wind_speed_unit || ""}`.trim(), "today");
      }
      add(at("Rain 1 h"), a.precip_1h != null ? `${a.precip_1h} mm` : null);
      add(at("Rain 24 h"), a.precip_24h != null ? `${a.precip_24h} mm` : null);
      add("Sunshine 1 h", a.sun_1h != null && Number.isFinite(+a.sun_1h) ? `${(+a.sun_1h).toFixed(1)} h` : null);
      if (sun) {
        // sun.sun gives the NEXT rise/set; after sunset both can be tomorrow's
        const today = dayKey(new Date(), tz);
        for (const [label, v] of [["Sunrise", sun.attributes.next_rising], ["Sunset", sun.attributes.next_setting]]) {
          const d = toDate(v);
          if (d) add(label, fmtTime(d, tz), dayKey(d, tz) > today ? "tomorrow" : "");
        }
      }
      const obsAt = toDate(a.observed_at);
      const amedas = a.station_primary_name && a.station_primary
        ? `AMeDAS ${a.station_primary_name} (${a.station_primary})`
        : a.station_primary ? `AMeDAS ${a.station_primary}` : "";
      // Observed is a row under the tiles, not a tenth tile (9 tiles = 3 x 3, no orphan hole)
      const observed = [obsAt ? fmtTime(obsAt, tz) : "", amedas].filter(Boolean).join(" · ");
      e.tiles.replaceChildren();
      for (const [label, value, note, band] of tiles) {
        const t = el("div", `tile${band ? ` wbgt${band.tone ? ` ${band.tone}` : band.level === 2 ? " warn" : ""}` : ""}`);
        t.append(el("span", "tl", label), el("b", "", value));
        if (note) t.appendChild(el("span", "tn", note));
        if (band) {
          // the band word stays ink; a mark before it from 警戒 (25): attention, hazard at 危険 (31)
          const w = el("span", "bw", band.word);
          w.title = "環境省: <21 ほぼ安全 · 21 注意 · 25 警戒 · 28 厳重警戒 · 31 危険";
          t.appendChild(w);
        }
        e.tiles.appendChild(t);
      }
      // sentences that do not fit a tile
      e.drows.replaceChildren();
      const row = (label, value) => {
        const r = el("div", "drow");
        r.append(el("span", "dl", label), el("span", "dv", value));
        e.drows.appendChild(r);
      };
      if (observed) row("Observed", observed);
      if (a.wind_text) row("Forecast wind", a.wind_text);
      const quake = this._st("quake");
      this._shown.wbgtTile = !!wbBand;
      this._shown.quakeRow = !!liveAttrs(quake);
      if (quake) row("Last quake", quakeLine(quake, tz));
    }

    _renderOverview() {
      const s = this._st("overview");
      const text = liveAttrs(s)?.text || "Couldn't reach the weather overview";
      this._el.otext.textContent = text;
      this._el.overview.hidden = !text;
    }

    _css() {
      return `
        /* Material 3 Expressive look. Every colour is a --jma-card-* token that falls back to the Material 3 theme variable, then to
           Home Assistant's own (light or dark as the theme says), then to a literal: see BASE_TOKENS. The only fixed colours are the
           SCALES that encode data (JMA rain bands, warning levels, kikikuru, temperature stops, map legends). */
        :host {
          --jc-font: var(--jma-card-font, var(--ha-font-family-body, Roboto, "Helvetica Neue", sans-serif));
          ${tokenDecls(false)}
          /* fallbacks the script reads (chips without a level, outlook dot) */
          --jc-surface: var(--jc-well);
          --jc-surface-2: var(--jc-well);
          --jc-on-data: #1a1a1a;
          --jc-on-data-dark: #ffffff;
          --jc-radius: var(--jma-card-radius, 32px);
          --jc-move: var(--jma-card-spring-fast, 350ms cubic-bezier(.42,1.67,.21,.90));
          --jc-fade: var(--jma-card-effects, 200ms cubic-bezier(.34,.80,.34,1));
        }
        /* hass.themes.darkMode: the dark literals (a theme that sets the Home Assistant variables overrides both) */
        ha-card.dark {
          ${tokenDecls(true)}
          color-scheme: dark;
        }
        :host { display: block; }
        [hidden] { display: none !important; }
        /* focus ring and state layer (hover .08, focus .10, pressed .10) on every control */
        button:focus-visible, [tabindex]:focus-visible, .scrub:focus-visible, a:focus-visible {
          outline: 3px solid var(--jc-secondary); outline-offset: 2px; }
        .toggle, .tab, .jpd, .controls button, .lbar button.chip, ha-card.nav:not(.full) .nexthour, ha-card.nav:not(.full) .radar { position: relative; }
        .toggle::after, .tab::after, .jpd::after, .controls button::after, ha-card.nav:not(.full) .nexthour::after, ha-card.nav:not(.full) .radar::after {
          content: ""; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0; pointer-events: none;
          transition: opacity var(--jc-fade); }
        .lbar button.chip::after { content: ""; position: absolute; inset: 6px 0; border-radius: 8px; background: currentColor; opacity: 0;
          pointer-events: none; transition: opacity var(--jc-fade); }
        @media (hover: hover) {
          .toggle:hover::after, .tab:hover::after, .jpd:hover::after, .controls button:not(:disabled):hover::after, .lbar button.chip:hover::after,
          ha-card.nav:not(.full) .nexthour:hover::after, ha-card.nav:not(.full) .radar:hover::after { opacity: 0.08; }
        }
        .toggle:focus-visible::after, .tab:focus-visible::after, .jpd:focus-visible::after, .controls button:focus-visible::after, .lbar button.chip:focus-visible::after,
        ha-card.nav:not(.full) .nexthour:focus-visible::after, ha-card.nav:not(.full) .radar:focus-visible::after,
        .toggle:active::after, .tab:active::after, .jpd:active::after, .controls button:not(:disabled):active::after, .lbar button.chip:active::after,
        ha-card.nav:not(.full) .nexthour:active::after, ha-card.nav:not(.full) .radar:active::after { opacity: 0.1; }

        /* full, narrow: one column in this order (the .left/.right wrappers are layout-only) */
        .fullgrid { display: flex; flex-direction: column; }
        .fullgrid > .left, .fullgrid > .right { display: contents; }
        .right > .now, .right > .jtext { order: 1; } .right > .chips, .right > .notices { order: 2; }
        .right > .nexthour, .right > .r15 { order: 3; }
        .left > .radar { order: 4; } .left > .lbar, .left > .controls { order: 5; } .right > .more { order: 6; }
        /* full, wide (panel view): radar left and kept in view, forecast right */
        ha-card.full.wide { overflow: visible; padding: 16px; }
        ha-card.full.wide .fullgrid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(420px, 1fr);
          column-gap: 24px; align-items: start; }
        /* the map column sticks below HA's fixed top bar (--header-height, 56 px; 0 px in kiosk mode),
           not at 12 px from the window's top edge, where the bar can cover the top of the map. The radar takes the
           bar, a 12 px gap above and ~45 px of slack for a wrapped chip row out of the window height: radar + layer chips +
           note + play row (about 133 px) then fit the visible window. 1,100 px caps it (a capture stretched to the page's
           height has no scroll for the column to travel, so it shows the column at the top and a blank beside the data). */
        ha-card.full.wide .left { display: block; position: sticky; align-self: start; top: calc(var(--jc-stick-top, var(--kiosk-header-height, var(--header-height, 56px))) + 12px); }
        ha-card.full.wide .right { display: block; min-width: 0; }
        ha-card.full.wide .radar { margin-top: 0; height: clamp(360px, calc(100vh - var(--jc-stick-top, var(--kiosk-header-height, var(--header-height, 56px))) - 190px), 1100px); }
        ha-card.full.wide .nh-plot { height: 56px; }
        /* the card is a tonal container: no border, no shadow; 32 px because it holds stacked panels (32 - 16 padding = 16 inside) */
        ha-card { display: block; padding: 16px; font-family: var(--jc-font); color: var(--jc-ink); overflow: hidden; min-width: 0; box-sizing: border-box;
          background: var(--jc-ground); border: 0; border-radius: var(--jc-radius); box-shadow: none; }
        /* stale data: only the picture and the bars are dimmed; every word keeps its contrast and says its age */
        .now.stale > .icon, .nexthour.stale > .nh-plot { opacity: 0.55; }
        .radar.stale > .frames { opacity: 0.45; }
        /* ...except a gone weather entity: its "—" and "Weather unavailable" are the whole statement (4.5:1) */
        .now.gone > * { opacity: 1; }
        .jtext { margin-top: 8px; font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
        /* full: JMA's sentence sits under the condition, the quieter voice */
        .right > .jtext { margin-top: 4px; padding: 0 4px; color: var(--jc-muted); }

        /* the card header: 22 px icon + title-large, inside the card */
        .chead { display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 0; margin: 0 0 12px; }
        .chead ha-icon { --mdc-icon-size: 22px; width: 22px; height: 22px; flex: 0 0 22px; display: inline-flex; color: var(--jc-muted); }
        .chead .cht { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 22px; line-height: 28px;
          letter-spacing: 0; font-weight: var(--ha-font-weight-medium, 500); font-variation-settings: "ROND" 60; color: var(--jc-ink); }
        /* the compact card's weather symbol (Material), in the quiet text colour; the JMA pictogram stays on the full page */
        .micon { grid-column: 1; grid-row: 1; align-self: center; --mdc-icon-size: 40px; width: 40px; height: 40px; margin-right: 12px;
          display: inline-flex; color: var(--jc-muted); }
        ha-card.full .micon { display: none; }
        .now.stale > .micon { opacity: 0.55; }

        /* ---- now: row A (icon · numeral · H/L + Feels, on the numeral's baseline), row B (condition) ---- */
        .now, .nexthour > .nh-head { color: var(--jc-ink); }
        .now { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; padding: 4px 4px 0; }
        /* margins, not column-gap: a missing icon leaves the numeral on the text edge. JMA draws its
           pictures low in the 80x60 frame: 40 % instead of 50 % centres them on the numeral.
           The glyph starts ~10 % inside JMA's image: pulled left so it starts on the text edge */
        .icon { grid-column: 1; grid-row: 1; width: 64px; height: 48px; margin-right: 12px; margin-left: -6.6px; object-fit: contain; object-position: left 40%; }
        .temp { grid-column: 2; grid-row: 1; align-self: last baseline; font-size: 56px; line-height: 1; font-variation-settings: "ROND" 100;
          font-weight: var(--ha-font-weight-normal, 400); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .temp .deg { font-size: 24px; line-height: 0; vertical-align: 0.85em; color: var(--jc-muted); }
        /* a missing numeral's "—": back by the dash's side bearing, so its ink starts on the text edge */
        .temp .t.na { margin-left: -0.07em; }
        .hilo { grid-column: 3; grid-row: 1; align-self: last baseline; justify-self: end; padding-left: 12px;
          text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .hilo .hl { font-size: 14px; line-height: 20px; letter-spacing: 0.1px; font-weight: var(--ha-font-weight-medium, 500); }
        .hl .k { font-size: 12px; line-height: 16px; letter-spacing: 0.5px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-muted); }
        .hl .lk { margin-left: 4px; }
        /* a missing high or low is "—" in the same width, so the block never shifts: a missing high starts
           where its figures would, a missing low ends on the text edge */
        .hl .v { display: inline-block; min-width: 2.7ch; }
        .hl .hv.na { text-align: left; }
        .hl .lv.na { text-align: right; }
        .hilo .hd { font-size: 12px; line-height: 16px; letter-spacing: 0.5px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-muted); }
        .hilo .feels { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); }
        /* the gloss moves under the name as a whole phrase; a second line of it is balanced */
        .cond { grid-column: 1 / -1; grid-row: 2; margin-top: 4px; display: flex; flex-wrap: wrap; align-items: baseline;
          column-gap: 8px; min-width: 0; }
        .cond .ja { font-size: 16px; line-height: 24px; letter-spacing: 0.15px; font-variation-settings: "ROND" 60; font-weight: var(--ha-font-weight-medium, 500);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .cond .ja:empty, .cond .en:empty { display: none; }
        .cond .en { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; color: var(--jc-muted); text-wrap: balance; min-width: 0; }
        ha-card.full .icon { width: 72px; height: 54px; margin-left: -7.5px; }
        ha-card.full.wide .icon { width: 80px; height: 60px; margin-left: -8.3px; }
        ha-card.full .temp { font-size: 56px; }
        ha-card.full.wide .temp { font-size: 64px; }
        ha-card.full.wide .temp .deg { font-size: 28px; }

        /* ---- row C: warning chips · row D: a dot, then the words ---- */
        .pill { padding: 2px 10px; border-radius: 8px; font-size: 12px; font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap; }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding: 0 4px; }
        /* needs you (level 2: advisory) = coral container; an alarm (level 3 and up) = error container, filled */
        .wchip { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 8px; box-sizing: border-box;
          font-size: 12px; line-height: 16px; letter-spacing: 0.5px; font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap;
          background: var(--jc-well); color: var(--jc-ink); }
        .wchip.lv2 { background: var(--jc-coral-container); color: var(--jc-on-coral-container); }
        .wchip.lv3, .wchip.lv4, .wchip.lv5 { background: var(--jc-error-container); color: var(--jc-on-error-container); }
        .wchip.lv4 { outline: 2px solid var(--jc-error); outline-offset: -2px; }
        .wchip.lv5 { outline: 2px solid var(--jc-on-error-container); outline-offset: -2px; font-weight: var(--ha-font-weight-bold, 700); }
        .notices { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; padding: 0 4px; min-width: 0; }
        .chips:not([hidden]) + .notices { margin-top: 8px; }
        .note { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 14px; line-height: 20px; letter-spacing: 0.25px;
          font-weight: var(--ha-font-weight-normal, 400); color: var(--jc-ink); font-variant-numeric: tabular-nums; }
        /* the dot sits on the text's baseline, lifted so its centre meets the middle of the letters */
        .note::before { content: ""; flex: 0 0 8px; height: 8px; align-self: baseline; transform: translateY(-0.1em); border-radius: 50%;
          background: var(--dot, var(--jc-muted)); }
        /* attention (needs you) = seal */
        .note.accent { --dot: var(--jc-accent); }
        /* a near typhoon is an alarm: filled error container, ink on it */
        .note.accent.k-typhoon, .note.accent.k-tsunami, .note.accent.k-heatspecial { padding: 8px 12px; border-radius: 8px; align-items: center; background: var(--jc-error-container);
          color: var(--jc-on-error-container); --dot: var(--jc-on-error-container); }
        .note.accent.k-typhoon > .nw > .m, .note.accent.k-typhoon > .nd,
        .note.accent.k-tsunami > .nw > .m, .note.accent.k-tsunami > .nd, .note.accent.k-heatspecial > .nw > .m, .note.accent.k-heatspecial > .nd { color: inherit; }
        .note.accent.k-typhoon::before, .note.accent.k-tsunami::before, .note.accent.k-heatspecial::before { transform: none; align-self: center; }
        .note > .nw { min-width: 0; overflow-wrap: anywhere; }
        .note > .nw > .b { font-weight: var(--ha-font-weight-medium, 500); }
        .note > .nw > .m { margin-left: 4px; color: var(--jc-muted); }
        .note > .nw > .m.j { margin-left: 0; }
        .note > .nd, .note > .nw > .nd.f { flex: 0 0 auto; margin-left: auto; font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); white-space: nowrap; }
        /* the advice's time floats right inside the first row, so only that row gives way to it */
        .note > .nw > .nd.f { float: right; margin-left: 8px; margin-top: 3px; }
        /* a one-row line keeps its floated time at the right edge */
        .note.k-advice > .nw, .note.k-tsunamijp > .nw { flex: 1 1 auto; }
        /* the outlook's dot is JMA's level colour (a scale): JMA yellow and black need an edge */
        .note.olook::before { outline: 1px solid var(--jc-muted); outline-offset: -1px; }

        /* ---- next hour: a tonal panel ---- */
        .nexthour { margin-top: 8px; padding: 12px 16px 8px; background: var(--jc-panel); border-radius: 16px; overflow: hidden; }
        ha-card.nav:not(.full) .nexthour, ha-card.nav:not(.full) .radar { cursor: pointer; }
        ha-card:not(.full) .nexthour { border-radius: 16px 16px 4px 4px; }
        ha-card.full .nexthour { cursor: default; }
        .nh-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .nh-title { font-size: 16px; font-weight: var(--ha-font-weight-medium, 500); letter-spacing: 0.15px; font-variation-settings: "ROND" 60; }
        .nh-sub { font-size: 12px; letter-spacing: 0.4px; color: var(--jc-muted); font-variant-numeric: tabular-nums; }
        .nh-head > .note { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); }
        .nh-head > .note::before { flex-basis: 6px; height: 6px; }
        /* the title, then its sub line straight under it */
        .nexthour > .nh-head { flex-direction: column; align-items: flex-start; gap: 0; }
        .nexthour > .nh-head > .nh-title { line-height: 24px; }
        .nexthour > .nh-head > .nh-sub { line-height: 16px; }
        .nh-plot { position: relative; height: 46px; margin-top: 8px; border-bottom: 1px solid var(--jc-line); }
        /* a dry hour is an 8 px baseline: "Now" is a quiet tick, not an ink-outlined bar that reads as rain */
        .nexthour.dry .nh-plot { height: 8px; }
        .nexthour.dry .col.now .bar { outline: 0; background: var(--jc-muted) !important; }
        .nexthour.dry .guide { display: none; }
        .guide { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--jc-line); }
        .guide span { position: absolute; right: 0; top: -16px; font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); }
        .guide.g1 { bottom: 30%; } .guide.g10 { bottom: 58%; } .guide.g30 { bottom: 82%; }
        .cols { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 3px; }
        /* always 13-slot geometry: one observed frame alone is one slot wide, not the whole chart */
        .col { flex: 0 1 calc((100% - 36px) / 13); height: 100%; display: flex; align-items: flex-end; }
        .col .bar { width: 100%; border-radius: 4px 4px 0 0; }
        .col.unknown .bar { background: repeating-linear-gradient(45deg, var(--jc-outline) 0 2px, transparent 2px 4px) !important; height: 30% !important; }
        .col.now .bar { outline: 2px solid var(--jc-ink); outline-offset: -2px; }
        .nh-axis { position: relative; height: 18px; margin-top: 2px; font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); font-variant-numeric: tabular-nums; }
        .nh-axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
        .right > .r15 { margin-top: 8px; padding: 12px 16px 8px; background: var(--jc-panel); border-radius: 16px; }
        .r15 > .r15-lbl { font-size: 12px; line-height: 16px; letter-spacing: 0.5px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-muted); margin-bottom: 4px; }
        .r15 > .nh-plot > .cols > .col { flex: 1 1 0; }
        .r15.dry > .nh-plot { height: 8px; }
        ha-card.full.wide .nexthour.dry .nh-plot, ha-card.full.wide .r15.dry > .nh-plot { height: 8px; }   /* beats the wide 56 px plot */
        .r15.dry > .nh-plot > .guide { display: none; }
        .r15.stale > .nh-plot { opacity: 0.55; }
        .nh-axis span:first-child { transform: none; left: 0 !important; }
        /* a lone label ("Now" with no forecast) stays at the left */
        .nh-axis span:last-child:not(:first-child) { transform: translateX(-100%); left: 100% !important; }

        /* ---- radar ---- */
        ha-card.noradar { display: flex; flex-direction: column; align-items: stretch; height: auto; position: relative; inset: auto; }
        ha-card.noradar > * { min-width: 0; align-self: stretch; }
        ha-card.noradar .radar { display: none; }
        .radar { position: relative; height: 140px; margin-top: 12px; border-radius: 16px; overflow: hidden; background: var(--jc-well); }
        /* in the compact stack the radar is a middle segment: 2 px gaps, inner corners 4 */
        ha-card:not(.full) .radar { margin-top: 2px; border-radius: 4px; }
        ha-card.full .radar { height: 380px; cursor: default; }
        /* square: the closed card is 1:1 and the radar takes the height left under the header.
           The radar is the only thing that shrinks (to its minimum); past that the card grows taller
           instead of clipping the summary and More (overflow visible: an aspect-ratio box that is not a
           scroll container never gets shorter than its content). */
        ha-card.square:not(.open) { aspect-ratio: 1 / 1; display: flex; flex-direction: column; overflow: visible; }
        ha-card.square:not(.open) > * { flex: 0 0 auto; }
        ha-card.square:not(.open) > .radar { flex: 1 1 0; height: auto; min-height: 120px; }
        /* square + open: the card grows; the radar keeps a fixed shape whether the page loaded open or not */
        ha-card.square.open .radar { height: auto; aspect-ratio: 16 / 10; }
        .radar img { position: absolute; max-width: none; user-select: none; pointer-events: none; }
        .radar > .fx { position: absolute; width: 0; height: 0; }
        /* saturate: inverted pale roads came out brown, so the colour is pulled back */
        .base.night img, .labels.night img { filter: invert(1) hue-rotate(180deg) saturate(0.45) brightness(0.8) contrast(0.85); }
        /* map labels: above the radar and the strikes, never in the way of a tap */
        .radar > .labels { position: absolute; inset: 0; pointer-events: none;
          -webkit-mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 44px), transparent 100%), linear-gradient(to bottom, transparent 0, #000 8px, #000 calc(100% - 20px), transparent 100%);
          -webkit-mask-composite: source-in;
          mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 44px), transparent 100%), linear-gradient(to bottom, transparent 0, #000 8px, #000 calc(100% - 20px), transparent 100%);
          mask-composite: intersect; }
        /* frames: smooth upscaling past z10. Dark map: near-white (<1 mm/h) pixels lose most of their
           alpha (#jc-dim). Light map: multiply, so near-white is a tint and never paints over the map. */
        .radar > .frames { position: absolute; inset: 0; }
        .frames.night { filter: url(#jc-dim); }
        .frames.daymap { mix-blend-mode: multiply; }
        .frames .layer { position: absolute; inset: 0; opacity: 0.72; visibility: hidden; }
        .home { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px;
          border-radius: 50%; background: var(--jc-ink); border: 2px solid var(--jc-surface);
          outline: 3px solid color-mix(in srgb, var(--jc-ink) 45%, transparent); }
        /* map overlays: a tonal scrim of the page surface, never a white or black literal */
        .stamp { position: absolute; left: 8px; bottom: 8px; font-size: 12px; line-height: 16px; letter-spacing: 0.4px; padding: 4px 8px; border-radius: 8px;
          background: color-mix(in srgb, var(--jc-surface) 82%, transparent); color: var(--jc-ink); font-variant-numeric: tabular-nums; }
        .stamp.fc { outline: 1px dashed var(--jc-ink); outline-offset: -1px; }
        .radar > .legend { position: absolute; right: 8px; bottom: 8px; padding: 6px 8px 4px; border-radius: 8px;
          background: color-mix(in srgb, var(--jc-surface) 88%, transparent); color: var(--jc-ink); font-size: 12px; line-height: 16px; letter-spacing: 0.4px; text-align: center;
          font-variant-numeric: tabular-nums; }
        .radar > .legend > i { display: block; height: 8px; }
        .radar > .lg-rain { display: grid; grid-template-columns: repeat(8, 24px); grid-template-rows: 8px auto; column-gap: 1px; row-gap: 2px; }
        /* the <1 swatch as the map shows it: edged on the legend, dimmed like the frames on dark */
        .radar > .lg-rain > i:first-of-type { outline: 1px solid var(--jc-muted); outline-offset: -1px; }
        .radar > .lg-rain.night > i:first-of-type { opacity: 0.35; outline: 0; }
        /* 雷: numbered swatches (thns 1-4, trns 1-2), JMA's legend colours; the digit is ink on the swatch */
        .radar > .lg-thunder { display: grid; grid-template-columns: auto repeat(4, 24px); column-gap: 2px; row-gap: 3px;
          align-items: center; padding: 6px 8px; }
        .radar > .lg-thunder > .lt { text-align: left; padding-right: 4px; }
        .radar > .lg-thunder > i { height: 16px; line-height: 16px; font-style: normal; color: var(--jc-on-data); font-weight: var(--ha-font-weight-medium, 500); }
        .radar > .lg-thunder > i.w { color: var(--jc-on-data-dark); }
        .radar > .lg-thunder > i:nth-of-type(3), .radar > .lg-thunder > i:nth-of-type(4) { font-weight: var(--ha-font-weight-bold, 700); }
        .radar > .lg-thunder > .lt:nth-of-type(2), .radar > .lg-thunder > .lt:nth-of-type(3) { grid-column: 1; }
        /* 落雷: the marks as the map draws them (white with a dark edge, as the canvas does) */
        .radar > .lg-thunder > .sk { justify-self: center; box-sizing: border-box; background: #fff; border: 1.5px solid #111; }
        .radar > .lg-thunder > .sk.cg { width: 9px; height: 9px; transform: rotate(45deg) scale(0.8, 1.05); }
        .radar > .lg-thunder > .sk.cc { width: 8px; height: 8px; border-radius: 50%; background: none; outline: 1.5px solid #fff; }
        .radar > .lg-thunder > .skt { grid-column: span 2; text-align: left; }
        .radar > .lg-risk { display: grid; grid-template-columns: repeat(5, minmax(26px, auto)); grid-template-rows: auto 8px auto;
          column-gap: 2px; row-gap: 2px; }
        .radar > .lg-risk > .lt, .radar > .lg-flood > .lt, .radar > .lg-flood > .lat { grid-column: 1 / -1; text-align: left; }
        .radar > .legend > i.k1 { outline: 1px solid var(--jc-muted); outline-offset: -1px; }
        .radar > .lg-flood { display: grid; grid-template-columns: repeat(8, 24px); grid-template-rows: auto 10px 16px auto;
          column-gap: 1px; row-gap: 2px; }
        .radar > .lg-flood > i { height: 10px; }
        .radar > .lg-flood > .ticks { grid-column: 1 / -1; position: relative; height: 16px; }
        .radar > .lg-flood > .ticks > b { position: absolute; top: 0; transform: translateX(-50%); font-weight: var(--ha-font-weight-normal, 400); }
        .radar > .lg-flood > .lat:empty { display: none; }
        .radar > .lg-sat { display: grid; grid-template-columns: auto 90px auto; column-gap: 6px; align-items: center; padding: 6px 8px; }
        .radar > .lg-sat > .lt { grid-column: 1 / -1; text-align: left; }
        .radar > .lg-sat > .grad { height: 8px; background: linear-gradient(90deg, #202020, #ffffff); outline: 1px solid var(--jc-muted); outline-offset: -1px; }
        .radar > .lg-sat > .l0 { grid-column: 1; grid-row: 2; } .radar > .lg-sat > .grad { grid-column: 2; grid-row: 2; }
        .radar > .lg-sat > .l1 { grid-column: 3; grid-row: 2; }
        /* typhoon track (Region preset and wider): theme text colour on the inverted map */
        .radar > .tyo { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; color: var(--jc-ink); }
        .radar > .tyo > .tc { fill: color-mix(in srgb, currentColor 7%, transparent); stroke: currentColor; stroke-width: 1.5; stroke-dasharray: 5 4; }
        .radar > .tyo > .tp { fill: none; stroke: currentColor; stroke-width: 1.2; opacity: 0.75; }
        .radar > .tyo > .tf { fill: none; stroke: currentColor; stroke-width: 2; stroke-dasharray: 7 4; }
        .radar > .tyo > .td { fill: currentColor; stroke: var(--jc-ground); stroke-width: 1.5; }
        .radar > .tyo > .tt { fill: currentColor; font-size: 12px; paint-order: stroke; stroke: var(--jc-ground);
          stroke-width: 3px; stroke-linejoin: round; }
        .radar > .tyo > .tn { fill: none; stroke: currentColor; stroke-width: 3; }
        .radar > .tyo > .tl { fill: currentColor; font-size: 12px; font-weight: var(--ha-font-weight-bold, 700); paint-order: stroke;
          stroke: var(--jc-ground); stroke-width: 3px; stroke-linejoin: round; }
        .radar > .stamp:empty { display: none; }
        /* strikes and city marks: above the frames and the typhoon track, under the home marker */
        .radar > .bolts { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .radar > .cities { position: absolute; inset: 0; pointer-events: none; }
        .cities > .city { position: absolute; transform: translate(-50%, -50%); display: grid; justify-items: center;
          min-width: 40px; padding: 2px 4px 3px; border-radius: 8px; line-height: 1.15; text-align: center;
          background: color-mix(in srgb, var(--jc-surface) 82%, transparent);
          outline: 1px solid var(--jc-line); outline-offset: -1px; color: var(--jc-ink); }
        .city > img { position: static; width: 30px; height: 20px; object-fit: contain; }
        .city > b { font-size: 14px; line-height: 18px; font-weight: var(--ha-font-weight-medium, 500); font-variant-numeric: tabular-nums; }
        .city > span { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); white-space: nowrap; }
        /* satellite: an opaque grey image, shown as it is (no multiply, no dimming) */
        .radar > .frames.sat { filter: none; mix-blend-mode: normal; }
        .radar > .frames.sat > .layer { opacity: 0.85; }
        .radar > .noradar { position: absolute; inset: 0; display: grid; place-items: center; font-size: 14px; color: var(--jc-muted); }

        /* ---- the drop-down: the last segment of the stack ---- */
        .toggle { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px;
          width: 100%; min-height: 48px; margin-top: 2px; padding: 4px 16px; border: 0; border-radius: 4px 4px 16px 16px; overflow: hidden;
          background: var(--jc-panel); color: var(--jc-ink); font: inherit; cursor: pointer; text-align: left; box-sizing: border-box;
          transition: border-radius var(--jc-move); }
        /* wraps rather than losing its end on a narrow card */
        .toggle .sum { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; padding: 4px 0; font-size: 14px; line-height: 16px; letter-spacing: 0.25px; color: var(--jc-muted); font-variant-numeric: tabular-nums; }
        .toggle .sum > .si { display: flex; flex-direction: column; min-width: 0; white-space: nowrap; }
        .toggle .sum .sl { font-size: 12px; line-height: 16px; letter-spacing: 0.5px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-muted); }
        .toggle .sum .sv { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; color: var(--jc-ink); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
        .toggle .tlabel { font-size: 14px; line-height: 20px; letter-spacing: 0.1px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-primary); }
        .toggle .chev { width: 7px; height: 7px; border-right: 2px solid var(--jc-primary); border-bottom: 2px solid var(--jc-primary);
          transform: rotate(45deg) translateY(-2px); transition: transform var(--jc-move); order: 3; margin-right: 4px; }
        ha-card.open .toggle .chev { transform: rotate(-135deg) translateY(-2px); }

        .more { margin-top: 12px; }
        .more section { margin-top: 8px; padding: 12px 16px 16px; background: var(--jc-panel); border-radius: 16px; }
        .more section.off { display: none; }
        .tabs { display: flex; gap: 2px; margin-top: 0; }
        .tab { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0;
          min-height: 56px; padding: 4px; border: 0; box-sizing: border-box; overflow: hidden;
          border-radius: 4px; background: var(--jc-panel); color: var(--jc-muted); font: inherit; cursor: pointer; min-width: 0;
          transition: border-radius var(--jc-move), background-color var(--jc-fade); }
        .tab:nth-child(1 of :not([hidden])) { border-radius: 16px 4px 4px 16px; }
        .tab:nth-last-child(1 of :not([hidden])) { border-radius: 4px 16px 16px 4px; }
        .tab:nth-child(1 of :not([hidden])):nth-last-child(1 of :not([hidden])) { border-radius: 16px; }
        .tab .tja { font-size: 14px; font-weight: var(--ha-font-weight-medium, 500); line-height: 20px; letter-spacing: 0.1px; }
        .tab .ten { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .tab.on { background: var(--jc-secondary-container); color: var(--jc-on-secondary-container); }
        /* the 警報 tab: an attention mark (seal) before the label */
        .tab.warn .tja::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%;
          vertical-align: 1px; background: var(--jc-accent); }
        ha-card.compact .more section h3 { display: none; }
        ha-card.compact .more section.pops6 h3, ha-card.compact .more section.overview h3 { display: block; }
        ha-card.compact .more .tabs + section:not(.off), ha-card.compact .more > .jtext:not([hidden]) + .tabs { margin-top: 8px; }
        .more > .jtext:not([hidden]) { margin: 0 0 12px; padding: 0 4px; }
        h3 { margin: 0 0 8px; font-size: 16px; line-height: 24px; letter-spacing: 0.15px; font-variation-settings: "ROND" 60; font-weight: var(--ha-font-weight-medium, 500); }
        ha-card.full h3 { font-size: 22px; line-height: 28px; letter-spacing: 0; }
        h3 span { font-weight: var(--ha-font-weight-normal, 400); color: var(--jc-muted); font-size: 12px; line-height: 16px; letter-spacing: 0.4px; margin-left: 4px; }
        .muted { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; color: var(--jc-muted); }
        /* a loading or empty line, as a status row */
        .state { display: flex; align-items: center; gap: 12px; min-height: 56px; flex: 1 1 auto; min-width: 0; font-size: 14px; line-height: 20px; letter-spacing: 0.25px; color: var(--jc-muted); }
        .state ha-icon { --mdc-icon-size: 24px; width: 24px; height: 24px; flex: 0 0 24px; display: inline-flex; color: var(--jc-muted); }

        .wrow { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin: 4px 0; font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
        .wrow > .wdot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 0 1px var(--jc-ink); }
        .wrow > .wname { font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-ink); }
        .wen { color: var(--jc-muted); }
        .headline { font-size: 14px; margin-top: 8px; line-height: 20px; letter-spacing: 0.25px; }
        .jma { display: flex; align-items: center; min-height: 48px; font-size: 14px; font-weight: var(--ha-font-weight-medium, 500); letter-spacing: 0.1px; color: var(--jc-primary); text-decoration: none; }
        .warnings > .kiki { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 12px; font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
        .warnings > .kiki > .kt { font-weight: var(--ha-font-weight-medium, 500); }
        .warnings > .kiki > .kv { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-variant-numeric: tabular-nums; }
        .kiki > .kv > .sep { color: var(--jc-muted); }
        .kiki > .kv > .kp > i { display: inline-block; width: 12px; height: 12px; margin-right: 6px; border-radius: 4px; vertical-align: -1px;
          outline: 1px solid var(--jc-muted); outline-offset: -1px; }
        .warnings > .kiki.stale > .kv { color: var(--jc-muted); }
        .warnings > .ol { margin-top: 12px; }
        .ol > .olh { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; font-weight: var(--ha-font-weight-medium, 500); margin-bottom: 8px; }
        .ol > .olh > span { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; font-weight: var(--ha-font-weight-normal, 400); color: var(--jc-muted); margin-left: 4px; }
        .ol > .olcells { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 2px; }
        .olcells > .olc { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 2px;
          min-height: 60px; padding: 6px 4px; border-radius: 8px; background: var(--jc-well); min-width: 0; text-align: center;
          font-variant-numeric: tabular-nums; }
        .olcells > .olc.nd::before { content: ""; position: absolute; left: -2px; top: 6px; bottom: 6px; width: 2px; border-radius: 1px; background: currentColor; }
        .olc > .oh { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; white-space: nowrap; opacity: 0.85; }
        .olc > .op { display: flex; flex-direction: column; font-size: 12px; line-height: 1.2; letter-spacing: 0.4px; font-weight: var(--ha-font-weight-bold, 700); }
        .olc > .or { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; white-space: nowrap; }
        .olcells > .olc.nd > .oh { padding-left: 3px; }
        ha-card.narrow .olcells > .olc { padding-left: 2px; padding-right: 2px; }
        ha-card.narrow .olc > .oh { letter-spacing: 0; }
        /* "明日 00" is wider than a phone cell: it takes two lines (明日 over 00), clear of the divider */
        ha-card.narrow .olcells > .olc.nd > .oh { white-space: normal; text-align: center; line-height: 14px; padding-left: 4px; }
        /* the same two-line rule in the wide right column too (its 8 cells are ~42 px, "明日 00" is ~48) */
        .olcells > .olc.nd > .oh { white-space: normal; text-align: center; line-height: 14px; padding-left: 4px; }
        /* on a phone the radar stamp sits above the legend (the two shared the bottom edge and overlapped) */
        ha-card.narrow .radar > .stamp { bottom: 48px; }
        .nwr { white-space: nowrap; }
        .ol > .olnote, .ol > .olkey { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); margin-top: 8px; }
        /* no tile carries a level: no empty band in the tiles, and no colour key for colours that are not there */
        .ol.nolv > .olcells > .olc { min-height: 0; }
        /* gate follow-up: the key stays (its text is just "mm = max 1-h rain" here) so a row of 0 is not read as "level 0" */
        .warnings > .ol.stale > .olnote { font-size: 14px; letter-spacing: 0.25px; }
        .typhoon > .tylist { display: grid; gap: 2px; }
        .tylist > .storm { padding: 12px 16px; border-radius: 4px; background: var(--jc-tile); font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
        .storm > .sh > b { font-size: 16px; line-height: 24px; letter-spacing: 0.15px; font-weight: var(--ha-font-weight-medium, 500); margin-right: 8px; }
        .storm > .sh > .ss, .storm > .sr { color: var(--jc-muted); }
        .storm > .sr.sc { color: var(--jc-ink); font-weight: var(--ha-font-weight-medium, 500); }
        .typhoon > .tykey, .japan > .jpkey { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); margin-top: 8px; }
        /* ---- 全国 ---- */
        .japan > .jpdays { display: flex; gap: 4px; margin-bottom: 8px; }
        .jpdays > .jpd { font: inherit; font-size: 14px; font-weight: var(--ha-font-weight-medium, 500); letter-spacing: 0.1px; min-height: 48px; padding: 0 16px; border-radius: 8px;
          cursor: pointer; overflow: hidden; border: 1px solid var(--jc-outline); background: none; color: var(--jc-ink); transition: border-radius var(--jc-move); }
        .jpdays > .jpd.on { border-color: transparent; background: var(--jc-secondary-container); color: var(--jc-on-secondary-container); }
        .jplist > .jp { display: grid; grid-template-columns: 3.4em minmax(0, 5.5em) 34px minmax(0, 1fr) 38px 30px 30px;
          column-gap: 8px; align-items: center; padding: 6px 0; min-height: 40px; box-sizing: border-box; font-size: 14px; line-height: 20px; letter-spacing: 0.25px; border-bottom: 1px solid var(--jc-line);
          font-variant-numeric: tabular-nums; }
        .jplist > .jp:last-child { border-bottom: 0; }
        .jp > .jpn { font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap; }
        .jp > .jpe, .jp > .jpt { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .jp > img { width: 34px; height: 24px; object-fit: contain; }
        .jp > .jpp { color: var(--jc-rain); font-size: 12px; letter-spacing: 0.4px; text-align: right; }
        .jp > .jpp.zero { color: var(--jc-muted); }
        .jpmore { display: block; min-height: 48px; margin: 4px 0 0 -12px; padding: 0 12px; border: 0; border-radius: 999px; background: none; cursor: pointer;
          font: inherit; font-size: 14px; line-height: 20px; letter-spacing: 0.1px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-primary); }
        .jpmore[hidden] { display: none; }
        .storm > .sh, .storm > .sr { text-wrap: balance; }
        .jp > .jpl { color: var(--jc-muted); text-align: right; }
        /* the high is ink; its temperature colour is a 3 px bar at the left of the cell (set as --tc, a scale) */
        .jp > .jph { text-align: right; font-weight: var(--ha-font-weight-medium, 500); border-left: 3px solid var(--tc, transparent); border-radius: 1px; }

        /* below 560 px of list width (a narrow column, a phone) the 全国 phrase drops under the city on its own line */
        .japan { container-type: inline-size; }
        @container (max-width: 560px) {
          .jplist > .jp { grid-template-columns: 3.4em minmax(0, 1fr) 34px 38px 30px 30px; row-gap: 2px; }
          .jp > .jpt { grid-column: 1 / -1; grid-row: 2; white-space: normal; overflow: visible; text-overflow: clip; }
        }
        /* contain: the 24 columns (~1100 px) must not become the card's min-content width, or a host that
           sizes by content flips the full card between its narrow and wide layouts in a resize loop */
        .hstrip { display: flex; gap: 2px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 8px;
          scrollbar-width: thin; -webkit-overflow-scrolling: touch; contain: inline-size; }
        .hcol { flex: 0 0 48px; scroll-snap-align: start; display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 8px 0; border-radius: 12px; font-variant-numeric: tabular-nums; }
        .hcol.cur { background: var(--jc-well); }
        .hcol .hh { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); }
        .hcol img { width: 30px; height: 22px; object-fit: contain; }
        .hcol .ht { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; font-weight: var(--ha-font-weight-medium, 500); }
        .hcol .hp { font-size: 12px; height: 16px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); }
        .hcol .hp.wet { color: var(--jc-rain); font-weight: var(--ha-font-weight-medium, 500); }
        .hcol .hc { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; min-height: 16px; color: var(--jc-muted); }
        .hkey { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); margin-top: 4px; }

        .pops { display: grid; grid-template-columns: repeat(auto-fit, minmax(66px, 1fr)); gap: 8px; }
        .pops6 { container-type: inline-size; }
        @container (max-width: 520px) { .pops { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        .pop { display: flex; flex-direction: column; gap: 4px; font-variant-numeric: tabular-nums; }
        .pop .pt { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); white-space: nowrap; }
        .pop b { font-size: 16px; line-height: 24px; letter-spacing: 0.15px; font-weight: var(--ha-font-weight-medium, 500); font-variation-settings: "ROND" 60; }
        .pop i { display: block; height: 6px; border-radius: 3px; background: var(--jc-rain); min-width: 2px; }

        .day { display: grid; grid-template-columns: 34px 44px 34px 40px 30px minmax(40px, 1fr) 30px 12px; align-items: center;
          column-gap: 8px; padding: 8px 0; min-height: 44px; box-sizing: border-box; font-size: 14px; line-height: 20px; letter-spacing: 0.25px; border-bottom: 1px solid var(--jc-line); font-variant-numeric: tabular-nums; }
        .day:last-child { border-bottom: 0; }
        .dname { font-weight: var(--ha-font-weight-medium, 500); }
        .ddate { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); white-space: nowrap; }
        .day img { width: 34px; height: 24px; object-fit: contain; }
        .dpop { color: var(--jc-rain); font-size: 12px; letter-spacing: 0.4px; text-align: right; }
        .dlo { color: var(--jc-muted); text-align: right; }
        .dhi { text-align: left; font-weight: var(--ha-font-weight-medium, 500); }
        .track { position: relative; height: 8px; border-radius: 4px; background: var(--jc-line); }
        .track i { position: absolute; top: 0; bottom: 0; box-sizing: border-box; border-radius: 4px; background: color-mix(in srgb, var(--jc-ink) 50%, transparent); }
        /* today from AMeDAS so far: hollow, so it never reads as a forecast bar */
        .track i.obs { background: none; border: 2px solid var(--jc-muted); }
        .track .norm { position: absolute; top: -4px; bottom: -4px; border-radius: 4px;
          background: color-mix(in srgb, var(--jc-ink) 30%, transparent); }
        .track .wh { position: absolute; top: 3px; height: 2px; border-radius: 1px;
          background: color-mix(in srgb, var(--jc-ink) 55%, transparent); }
        .track b { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
          background: var(--jc-panel); outline: 2px solid var(--jc-ink); }
        .dlo.obs, .dhi.obs { color: var(--jc-muted); font-weight: var(--ha-font-weight-normal, 400); }
        .drel { font-size: 12px; letter-spacing: 0.4px; color: var(--jc-muted); }
        /* under 400 px of card width (ha-card.tight) the 7-day row drops the confidence letter and tightens its columns (fits 250 px) */
        ha-card.tight .day { grid-template-columns: 34px 40px 30px 34px 26px minmax(24px, 1fr) 26px; column-gap: 6px; }
        ha-card.tight .drel { display: none; }
        .wkey { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); margin-top: 8px; }

        .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 2px; }
        /* full mode keeps the nine tiles 3 x 3 at every width (auto-fill gave 4+4+1 / 8+1 with an orphan hole) */
        ha-card.full .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .tile { display: flex; flex-direction: column; gap: 0; padding: 12px; border-radius: 4px; background: var(--jc-tile); }
        .tile .tl { font-size: 12px; line-height: 16px; letter-spacing: 0.5px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-muted); }
        .tile b { white-space: nowrap; font-size: 16px; line-height: 24px; letter-spacing: 0.15px; font-weight: var(--ha-font-weight-medium, 500); font-variant-numeric: tabular-nums; font-variation-settings: "ROND" 60; }
        .tile .tn { font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); }
        /* WBGT band: the word in ink; from 警戒 a dot (needs you, seal); at 危険 the whole tile is an alarm: filled error container */
        .tiles > .tile.wbgt > .bw { align-self: flex-start; margin-top: 2px; font-size: 14px; font-weight: var(--ha-font-weight-medium, 500);
          line-height: 20px; letter-spacing: 0.1px; color: var(--jc-ink); }
        .tiles > .tile.wbgt.warn > .bw::before, .tiles > .tile.wbgt.hot > .bw::before, .tiles > .tile.wbgt.danger > .bw::before {
          content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 50%; vertical-align: 1px;
          background: var(--jc-accent); }
        .tiles > .tile.wbgt.danger { background: var(--jc-error-container); }
        .tiles > .tile.wbgt.danger .tl, .tiles > .tile.wbgt.danger b, .tiles > .tile.wbgt.danger .tn, .tiles > .tile.wbgt.danger > .bw { color: var(--jc-on-error-container); }
        .tiles > .tile.wbgt.danger > .bw::before { background: var(--jc-on-error-container); }
        .drows { display: grid; gap: 8px; margin-top: 12px; }
        .drows:empty { display: none; }
        .drow { display: grid; grid-template-columns: 96px minmax(0, 1fr); column-gap: 8px; align-items: baseline;
          font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
        .drow .dl { font-size: 12px; line-height: 16px; letter-spacing: 0.5px; font-weight: var(--ha-font-weight-medium, 500); color: var(--jc-muted); }
        .drow .dv { overflow-wrap: anywhere; }

        .otext { font-size: 14px; white-space: pre-line; line-height: 24px; letter-spacing: 0.25px; }

        .controls { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; margin-top: 12px; }
        /* tonal buttons: full radius, 8 while pressed */
        .controls button { font: inherit; font-size: 14px; font-weight: var(--ha-font-weight-medium, 500); letter-spacing: 0.1px; border: 0;
          background: var(--jc-secondary-container); color: var(--jc-on-secondary-container);
          border-radius: 999px; padding: 0 16px; min-height: 48px; min-width: 48px; cursor: pointer; overflow: hidden;
          transition: border-radius var(--jc-move), background-color var(--jc-fade); }
        .controls button.on { background: var(--jc-primary-container); color: var(--jc-on-primary-container); }
        /* the one filled button of the card */
        .controls button.play { background: var(--jc-primary); color: var(--jc-on-primary); }
        .controls button.play.busy { opacity: 0.6; cursor: progress; }
        .zooms { display: flex; gap: 4px; }
        /* pass 4: one selector family with the layer chips: 8 px, outlined; the selected one secondary-container */
        .controls > .zooms > button { border-radius: 8px; background: none; border: 1px solid var(--jc-outline); color: var(--jc-ink); }
        .controls > .zooms > button.on { background: var(--jc-secondary-container); color: var(--jc-on-secondary-container); border-color: transparent; }
        .controls > .zooms { grid-column: 3; }
        .controls > .zooms > button:disabled { background: color-mix(in srgb, var(--jc-ink) 10%, transparent); color: color-mix(in srgb, var(--jc-ink) 38%, transparent); cursor: not-allowed; }
        .left > .lbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px; margin-top: 8px; }
        .left > .lnote { order: 5; margin-top: 8px; font-size: 14px; line-height: 20px; letter-spacing: 0.25px; color: var(--jc-muted); font-variant-numeric: tabular-nums; }
        .controls > .zooms { flex-wrap: wrap; justify-content: flex-end; }
        .lbar > .lchips, .lbar > .lsubs { display: flex; flex-wrap: wrap; gap: 0 4px; }
        .lbar > .lsubs { padding-left: 12px; border-left: 1px solid var(--jc-line); }
        /* filter chips: 8 px corners; a 44 px hit area around a 32 px chip (drawn by ::before) */
        .lbar button.chip { font: inherit; font-size: 14px; line-height: 20px; letter-spacing: 0.1px; font-weight: var(--ha-font-weight-medium, 500);
          min-height: 48px; min-width: 48px; padding: 0 16px; box-sizing: border-box; isolation: isolate;
          border: 0; background: none; color: var(--jc-ink); cursor: pointer; white-space: nowrap; }
        .lbar button.chip::before { content: ""; position: absolute; inset: 8px 0; z-index: -1; border-radius: 8px; border: 1px solid var(--jc-outline);
          transition: border-radius var(--jc-move), background-color var(--jc-fade); }
        .lbar button.chip.on { color: var(--jc-on-secondary-container); }
        .lbar button.chip.on::before { background: var(--jc-secondary-container); border-color: transparent; }
        .lbar button.chip.sub { font-size: 14px; }
        /* scrubber: a neutral track, the forecast part hatched, a tick at "now"; the native control on
           top keeps keyboard and touch. The track is inset by half the thumb so marks line up with it. */
        .scrubwrap { position: relative; height: 48px; min-width: 0; --thumb: 20px; }
        .strack { position: absolute; left: calc(var(--thumb) / 2); right: calc(var(--thumb) / 2); top: 50%; height: 6px;
          margin-top: -3px; border-radius: 3px; background: var(--jc-well); }
        .strack .sfc { position: absolute; top: 0; bottom: 0; right: 0; border-radius: 0 3px 3px 0;
          background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--jc-ink) 38%, transparent) 0 3px, transparent 3px 6px); }
        .strack .snow { position: absolute; top: -6px; bottom: -6px; width: 2px; margin-left: -1px; border-radius: 1px;
          background: var(--jc-ink); }
        .scrub { -webkit-appearance: none; appearance: none; position: absolute; inset: 0; width: 100%; height: 100%;
          margin: 0; background: transparent; cursor: pointer; }
        .scrub:focus-visible { border-radius: 8px; }
        .scrub::-webkit-slider-runnable-track { height: 48px; background: transparent; border: 0; }
        .scrub::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: var(--thumb); height: var(--thumb);
          margin-top: calc((48px - var(--thumb)) / 2); border-radius: 50%; background: var(--jc-primary);
          border: 2px solid var(--jc-ground); box-sizing: border-box; }
        .scrub::-moz-range-track { background: transparent; border: 0; }
        .scrub::-moz-range-progress { background: transparent; }
        .scrub::-moz-range-thumb { width: var(--thumb); height: var(--thumb); border-radius: 50%; background: var(--jc-primary);
          border: 2px solid var(--jc-ground); box-sizing: border-box; }
        .nofc { position: absolute; right: calc(var(--thumb) / 2); top: 0; font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted);
          pointer-events: none; white-space: nowrap; }
        .attr { margin-top: 12px; padding: 0 4px; font-size: 12px; line-height: 16px; letter-spacing: 0.4px; color: var(--jc-muted); text-align: left; }
        .attr > .src { white-space: nowrap; }
        .attr a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
        .attr a:hover { color: var(--jc-ink); }
        /* a Japanese label stays whole */
        .tile .tl, .tile .tn, .tile b, .drow .dv, .storm { word-break: keep-all; }
        /* under 500 px (ha-card.narrow): the 全国 phrase under the city, the zoom buttons on their own row, the layer chips in 3 columns */
        ha-card.narrow .jplist > .jp { grid-template-columns: 3.4em minmax(0, 1fr) 34px 38px 30px 30px; row-gap: 2px; }
        ha-card.narrow .jp > .jpt { grid-column: 1 / -1; grid-row: 2; white-space: normal; overflow: visible; text-overflow: clip; }
        ha-card.narrow .controls { grid-template-columns: auto minmax(0, 1fr); }
        ha-card.narrow .controls > .zooms { grid-column: 1 / -1; justify-content: flex-start; }
        ha-card.narrow .lbar > .lchips { flex: 1 1 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        ha-card.narrow .lbar button.chip { padding: 0 8px; }
        /* press = corner morph (spring), only when motion is welcome */
        @media (prefers-reduced-motion: no-preference) {
          .toggle:active { border-radius: 8px; }
          @media (hover: hover) { .tab:not(.on):hover { border-radius: 12px; } }
          .tab:not([hidden]):active { border-radius: 16px; }
          .jpdays > .jpd:active { border-radius: 4px; }
          .controls button:not(:disabled):active { border-radius: 8px; }
          .lbar button.chip:active::before, .lbar button.chip:active::after { border-radius: 4px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .toggle, .tab, .jpd, .controls button, .lbar button.chip::before, .toggle .chev { transition: none; }
          .toggle::after, .tab::after, .jpd::after, .controls button::after, .lbar button.chip::after,
          ha-card.nav:not(.full) .nexthour::after, ha-card.nav:not(.full) .radar::after { transition: none; }
        }
        /* the large-screen step (touch screen, 1800 px or wider, read from across a room): 14 -> 16/24, 12 -> 14/20, h3 22/28.
           Same selectors as the rules above, and last, so the order decides. */
        @media (min-width: 1800px) and (pointer: coarse) {
          .jtext { font-size: 16px; line-height: 24px; }
          .note { font-size: 16px; line-height: 24px; }
          .note > .nd, .note > .nw > .nd.f { font-size: 14px; line-height: 20px; }
          .nh-head > .note { font-size: 14px; line-height: 20px; }
          .cond .en { font-size: 16px; line-height: 24px; }
          .jplist > .jp { font-size: 16px; line-height: 24px; letter-spacing: 0.5px; }
          .jp > .jpe, .jp > .jpt { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
          .jp > .jpp { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
          .day { font-size: 16px; line-height: 24px; letter-spacing: 0.5px; }
          .ddate { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
          .dpop { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
          .drel { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
          .hcol .hh { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; }
          .hcol .ht { font-size: 16px; line-height: 24px; letter-spacing: 0.5px; }
          .hcol .hp { font-size: 14px; height: 20px; line-height: 20px; letter-spacing: 0.25px; }
          .hcol .hc { font-size: 14px; line-height: 20px; letter-spacing: 0.25px; min-height: 20px; }
          .tile .tl { font-size: 14px; line-height: 20px; }
          .tile .tn { font-size: 14px; line-height: 20px; }
          .drow { font-size: 16px; line-height: 24px; }
          .drow .dl { font-size: 14px; line-height: 20px; }
          .otext { font-size: 16px; line-height: 24px; }
          h3 { font-size: 22px; line-height: 28px; letter-spacing: 0; }
        }
            `;
    }
  }

  // Every render section runs on its own: a bad attribute skips that section, never the whole card, whoever calls it
  // (a hass push, the resize observer, a button, a forecast message). Each distinct message is logged once per card.
  for (const name of Object.getOwnPropertyNames(HaJmaCard.prototype).filter((n) => /^_render[A-Z]/.test(n))) {
    const section = HaJmaCard.prototype[name];
    HaJmaCard.prototype[name] = function (...args) {
      try { return section.apply(this, args); } catch (err) {
        const seen = this._errSeen || (this._errSeen = new Set());
        if (!seen.has(String(err)) && seen.size < 20) { seen.add(String(err)); console.warn(`${CARD_TAG}:`, err); }
        return undefined;
      }
    };
  }

  /** The visual editor: one <ha-form> over EDITOR_SCHEMA; every change goes up as `config-changed`. */
  class HaJmaCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
      this._hass = null;
      this._form = null;
    }

    set hass(hass) {
      this._hass = hass;
      if (this._form) this._form.hass = hass;
    }

    get hass() { return this._hass; }

    setConfig(config) {
      this._config = config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {};
      this._draw();
    }

    _draw() {
      if (!this._form) {
        const form = document.createElement("ha-form");
        form.computeLabel = (s) => EDITOR_LABELS[s.name] || s.name;
        form.computeHelper = (s) => EDITOR_HELP[s.name] || "";
        form.addEventListener("value-changed", (ev) => this._changed(ev));
        this.shadowRoot.appendChild(form);
        this._form = form;
      }
      this._form.hass = this._hass;
      this._form.schema = EDITOR_SCHEMA;
      this._form.data = editorData(this._config);
    }

    _changed(ev) {
      ev.stopPropagation();
      const value = ev.detail && ev.detail.value;
      if (!value || typeof value !== "object") return;
      this._config = cleanEditorConfig(this._config, value);
      this._form.data = editorData(this._config);
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
    }
  }

  if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, HaJmaCard);
  if (!customElements.get(`${CARD_TAG}-editor`)) customElements.define(`${CARD_TAG}-editor`, HaJmaCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === CARD_TAG)) {
    window.customCards.push({
      type: CARD_TAG,
      name: "JMA Weather Card (Unofficial)",
      description: "Forecast, warnings, next-hour rain and a rain radar from the ha-jma integration (data from the Japan Meteorological Agency; not affiliated with it).",
      preview: true,
      documentationURL: "https://github.com/glockpete/ha-jma-card",
    });
  }
  console.info(`%c HA-JMA-CARD %c ${CARD_VERSION} `,
    "color:#003733;background:#81d5cc;font-weight:500", "color:#81d5cc;background:transparent");
}
