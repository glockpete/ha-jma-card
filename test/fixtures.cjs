"use strict";
// Synthetic Home Assistant data for the tests: one made-up ha-jma install watching Chiyoda, Tokyo (Tokyo Station, 35.6812 N
// 139.7671 E, JMA area code 1310100), a second JMA area to prove the device scoping, and one weather entity from another
// integration. Nothing here is a real reading.

const HOME = { lat: 35.6812, lon: 139.7671 };
const AREA = { code: "1310100", name: "Chiyoda", name_ja: "千代田区" };

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const mk = (id, state, attributes = {}, ageMs = 60000) =>
  ({ entity_id: id, state: String(state), attributes, last_updated: iso(ageMs), last_changed: iso(ageMs) });

/** The entity-registry display entries Home Assistant puts in `hass.entities`. */
function registry() {
  const e = (entity_id, device_id, platform, translation_key) => ({ entity_id, device_id, platform, translation_key, name: null });
  const chiyoda = "dev_chiyoda";
  return {
    "weather.jma_chiyoda": e("weather.jma_chiyoda", chiyoda, "jma", "weather"),
    "sensor.jma_chiyoda_warnings": e("sensor.jma_chiyoda_warnings", chiyoda, "jma", "warning_level"),
    "sensor.jma_chiyoda_rain_next_hour": e("sensor.jma_chiyoda_rain_next_hour", chiyoda, "jma", "rain_next_hour"),
    "sensor.jma_chiyoda_radar_frames": e("sensor.jma_chiyoda_radar_frames", chiyoda, "jma", "radar_frames"),
    "sensor.jma_chiyoda_overview": e("sensor.jma_chiyoda_overview", chiyoda, "jma", "overview"),
    "binary_sensor.jma_chiyoda_feed_problem": e("binary_sensor.jma_chiyoda_feed_problem", chiyoda, "jma", "feed_problem"),
    "sensor.jma_chiyoda_last_earthquake": e("sensor.jma_chiyoda_last_earthquake", chiyoda, "jma", "last_earthquake"),
    "sensor.jma_chiyoda_warning_outlook": e("sensor.jma_chiyoda_warning_outlook", chiyoda, "jma", "warning_outlook"),
    "sensor.jma_chiyoda_typhoon": e("sensor.jma_chiyoda_typhoon", chiyoda, "jma", "typhoon"),
    "sensor.jma_chiyoda_wbgt": e("sensor.jma_chiyoda_wbgt", chiyoda, "jma", "wbgt"),
    "sensor.jma_chiyoda_kikikuru": e("sensor.jma_chiyoda_kikikuru", chiyoda, "jma", "kikikuru"),
    "sensor.jma_chiyoda_rain_outlook": e("sensor.jma_chiyoda_rain_outlook", chiyoda, "jma", "rain_outlook"),
    "sensor.jma_chiyoda_japan": e("sensor.jma_chiyoda_japan", chiyoda, "jma", "japan"),
    "sensor.jma_chiyoda_tsunami": e("sensor.jma_chiyoda_tsunami", chiyoda, "jma", "tsunami"),
    "sensor.jma_chiyoda_heat_alert": e("sensor.jma_chiyoda_heat_alert", chiyoda, "jma", "heat_alert"),
    // a second area of the same integration, and an unrelated weather entity: neither may be picked for the Chiyoda card
    "weather.jma_osaka": e("weather.jma_osaka", "dev_osaka", "jma", "weather"),
    "sensor.jma_osaka_wbgt": e("sensor.jma_osaka_wbgt", "dev_osaka", "jma", "wbgt"),
    "weather.forecast_home": e("weather.forecast_home", "dev_met", "met", null),
    "sensor.other_wbgt": e("sensor.other_wbgt", chiyoda, "other_integration", "wbgt"),
  };
}

const WEATHER_ATTRS = {
  friendly_name: "JMA Chiyoda", temperature: 21.4, temperature_unit: "°C", apparent_temperature: 20.8, humidity: 58,
  pressure: 1013, pressure_unit: "hPa", wind_speed: 14.4, wind_speed_unit: "km/h", wind_bearing: 180, precipitation_unit: "mm",
  condition: "cloudy", attribution: "出典：気象庁ホームページ · Weather data by Open-Meteo.com",
  jma_name_ja: "くもり", jma_name_en: "Cloudy", temp_max: 24, temp_min: 17, observed_at: iso(5 * 60000),
  station_primary_name: "Tokyo",
};

function states(over = {}) {
  const s = {
    "weather.jma_chiyoda": mk("weather.jma_chiyoda", "cloudy", WEATHER_ATTRS),
    "sensor.jma_chiyoda_warnings": mk("sensor.jma_chiyoda_warnings", "0", { warnings: [], area_missing: false }),
    "sensor.jma_chiyoda_rain_next_hour": mk("sensor.jma_chiyoda_rain_next_hour", "0", { basetime: "", slots: [] }),
    "sensor.jma_chiyoda_radar_frames": mk("sensor.jma_chiyoda_radar_frames", "ok", { latitude: HOME.lat, longitude: HOME.lon, layers: {} }),
    "sensor.jma_chiyoda_overview": mk("sensor.jma_chiyoda_overview", "ok", { text: "Cloudy through the evening." }),
    "binary_sensor.jma_chiyoda_feed_problem": mk("binary_sensor.jma_chiyoda_feed_problem", "off"),
    "weather.jma_osaka": mk("weather.jma_osaka", "sunny", { ...WEATHER_ATTRS, friendly_name: "JMA Osaka" }),
    "sensor.jma_osaka_wbgt": mk("sensor.jma_osaka_wbgt", "33.0", {}),
    "weather.forecast_home": mk("weather.forecast_home", "rainy", { friendly_name: "Forecast" }),
    "sun.sun": mk("sun.sun", "above_horizon", {}),
  };
  return { ...s, ...over };
}

/** A hass object. `over` replaces any top-level key; `over.states` is merged into the default states. */
function makeHass(over = {}) {
  const { states: st, ...rest } = over;
  return {
    language: "en",
    locale: { language: "en", number_format: "language", time_format: "language" },
    config: { latitude: HOME.lat, longitude: HOME.lon, time_zone: "Asia/Tokyo", unit_system: { temperature: "°C" } },
    themes: { darkMode: false, theme: "default" },
    entities: registry(),
    states: states(st),
    ...rest,
  };
}

/** Sensors that make the optional parts show. */
const EXTRA = {
  wbgt: mk("sensor.jma_chiyoda_wbgt", "27.5", { target_date: "today" }),
  quake: mk("sensor.jma_chiyoda_last_earthquake", iso(3600000), {
    time: iso(3600000), hypocenter: "千葉県北西部", magnitude: 4.6, max_shindo: "3",
    area: "東京都２３区", area_shindo: "2", local_name: "千代田区", local_shindo: "1",
  }),
  tsunami: mk("sensor.jma_chiyoda_tsunami", "warning", { home_area: "東京湾内湾", home_height: "高い", home_height_m: 3 }),
  heat: mk("sensor.jma_chiyoda_heat_alert", "alert", { tomorrow: "none", wbgt_max: 31.2, wbgt_date: "2026-08-01", target_today: "2026-08-01" }),
  lightningCounter: mk("sensor.strikes_counter", "3", {}),
};

/** An hourly forecast in the shape Home Assistant's forecast subscription sends, starting at the current hour. */
function hourly(n = 6) {
  const start = new Date(Math.floor(Date.now() / 3600000) * 3600000);
  return Array.from({ length: n }, (_, i) => ({
    datetime: new Date(start.getTime() + i * 3600000).toISOString(), condition: "cloudy", temperature: 21 + i * 0.5,
    precipitation: 0, precipitation_probability: 10, apparent_temperature: 20,
  }));
}

module.exports = { HOME, AREA, iso, mk, registry, states, makeHass, EXTRA, hourly, WEATHER_ATTRS };
