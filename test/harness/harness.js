"use strict";
// Builds a made-up hass (Chiyoda, Tokyo Station 35.6812 N 139.7671 E) and mounts the card in it.
(function () {
  const q = new URLSearchParams(location.search);
  const mode = q.get("mode") === "full" ? "full" : "compact";
  const dark = q.get("theme") === "dark";
  const daytime = q.get("sun") !== "below";
  const base = /^\d{14}$/.test(q.get("base") || "") ? q.get("base") : "";   // newest observed radar frame (UTC), from JMA's frame list
  document.body.className = dark ? "dark" : "light";
  document.getElementById("host").className = mode;

  const NOW = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const pad = (n) => String(n).padStart(2, "0");
  const jt = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`; };
  const jms = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), 0);
  const st = (id, state, attributes) => ({ entity_id: id, state: String(state), attributes: attributes || {}, last_updated: iso(NOW - 60000), last_changed: iso(NOW - 60000) });
  const reg = (id, device, platform, key) => ({ entity_id: id, device_id: device, platform, translation_key: key });

  // radar frames: the observed ones back from `base`, the forecast ones after it (5-minute steps), as the nowcast lists them
  const baseMs = base ? jms(base) : Math.floor(NOW / 300000) * 300000;
  const basetime = base || jt(baseMs);
  const past = Array.from({ length: 7 }, (_, i) => jt(baseMs - (6 - i) * 300000));
  const forecast = Array.from({ length: 12 }, (_, i) => jt(baseMs + (i + 1) * 300000));

  // the next hour: dry now, light rain from about 25 minutes on
  const bands = [0, 0, 0, 0, 0, 2, 3, 3, 3, 2, 1, 0, 0];
  const start = Math.floor(NOW / 300000) * 300000;
  const series = bands.map((band, i) => ({ time: iso(start + i * 300000), band, minutes: i * 5 }));

  // sun.sun: the next rising and setting, in the future, as Home Assistant reports them
  const day = 86400000;
  const at = (h, m) => { const d = new Date(NOW + 9 * 3600000); d.setUTCHours(h, m, 0, 0); return d.getTime() - 9 * 3600000; };
  const rise = at(5, 55) > NOW ? at(5, 55) : at(5, 55) + day;
  const set = at(17, 25) > NOW ? at(17, 25) : at(17, 25) + day;

  const weather = {
    friendly_name: "JMA Chiyoda", temperature: 21.4, temperature_unit: "°C", apparent_temperature: 20.6, humidity: 58,
    pressure: 1013, pressure_unit: "hPa", wind_speed: 14.4, wind_speed_unit: "km/h", wind_bearing: 180, precipitation_unit: "mm",
    condition: "cloudy", attribution: "出典：気象庁ホームページ · Weather data by Open-Meteo.com",
    jma_name_ja: "くもり", jma_name_en: "Cloudy", jma_icon: "200.svg", jma_text: "くもり　夜　雨",
    temp_max: 24, temp_min: 17, gust_max_today: 9.2, gust_max_time: iso(NOW - 3 * 3600000), precip_1h: 0, precip_24h: 0.5, sun_1h: 0.2,
    observed_at: iso(NOW - 5 * 60000), station_primary_name: "Tokyo", station_primary: "44132",
  };

  const entities = {
    "weather.jma_chiyoda": reg("weather.jma_chiyoda", "dev1", "jma", "weather"),
    "sensor.jma_chiyoda_warnings": reg("sensor.jma_chiyoda_warnings", "dev1", "jma", "warning_level"),
    "sensor.jma_chiyoda_rain_next_hour": reg("sensor.jma_chiyoda_rain_next_hour", "dev1", "jma", "rain_next_hour"),
    "sensor.jma_chiyoda_radar_frames": reg("sensor.jma_chiyoda_radar_frames", "dev1", "jma", "radar_frames"),
    "sensor.jma_chiyoda_overview": reg("sensor.jma_chiyoda_overview", "dev1", "jma", "overview"),
    "sensor.jma_chiyoda_wbgt": reg("sensor.jma_chiyoda_wbgt", "dev1", "jma", "wbgt"),
    "sensor.jma_chiyoda_last_earthquake": reg("sensor.jma_chiyoda_last_earthquake", "dev1", "jma", "last_earthquake"),
    "binary_sensor.jma_chiyoda_feed_problem": reg("binary_sensor.jma_chiyoda_feed_problem", "dev1", "jma", "feed_problem"),
  };

  const states = {
    "weather.jma_chiyoda": st("weather.jma_chiyoda", "cloudy", weather),
    "sensor.jma_chiyoda_warnings": st("sensor.jma_chiyoda_warnings", "1", {
      area_missing: false,
      warnings: [{ code: "10", name_ja: "大雨注意報", name_en: "Heavy rain advisory", status: "発表", level: 2 }],
    }),
    "sensor.jma_chiyoda_rain_next_hour": st("sensor.jma_chiyoda_rain_next_hour", "3", {
      basetime, series, raining_now: false, minutes_to_rain: 25,
    }),
    "sensor.jma_chiyoda_radar_frames": st("sensor.jma_chiyoda_radar_frames", "ok", {
      tile_template: "https://www.jma.go.jp/bosai/jmatile/data/nowc/{basetime}/none/{validtime}/surf/hrpns/{z}/{x}/{y}.png",
      home: [35.6812, 139.7671], zoom: 10, basetime, past, forecast, layers: {},
    }),
    "sensor.jma_chiyoda_overview": st("sensor.jma_chiyoda_overview", "ok", { text: "千代田区周辺は、高気圧の縁を回る湿った空気の影響で、くもりとなっています。夜は雨の降る所があるでしょう。" }),
    "sensor.jma_chiyoda_wbgt": st("sensor.jma_chiyoda_wbgt", "26.1", {}),
    "sensor.jma_chiyoda_last_earthquake": st("sensor.jma_chiyoda_last_earthquake", iso(NOW - 5 * 3600000), {
      time: iso(NOW - 5 * 3600000), hypocenter: "千葉県北西部", magnitude: 4.6, max_shindo: "3",
      area: "東京都２３区", area_shindo: "2", local_name: "千代田区", local_shindo: "1",
    }),
    "binary_sensor.jma_chiyoda_feed_problem": st("binary_sensor.jma_chiyoda_feed_problem", "off", {}),
    "sun.sun": st("sun.sun", daytime ? "above_horizon" : "below_horizon", { next_rising: iso(rise), next_setting: iso(set) }),
  };

  // the 7-day and hourly forecasts, as Home Assistant's forecast subscription sends them
  const dayStart = Math.floor((NOW + 9 * 3600000) / day) * day - 9 * 3600000;   // 00:00 in Tokyo
  const conds = [["cloudy", "200.svg"], ["rainy", "300.svg"], ["partlycloudy", "101.svg"], ["sunny", "100.svg"], ["sunny", "100.svg"], ["cloudy", "200.svg"], ["rainy", "300.svg"]];
  const daily = conds.map(([condition, jma_icon], i) => ({
    datetime: iso(dayStart + i * day), condition, jma_icon, temperature: 24 - (i % 3), templow: 17 - (i % 2),
    precipitation_probability: condition === "rainy" ? 70 : condition === "cloudy" ? 30 : 10, reliability: i < 2 ? "" : ["A", "A", "B", "C", "C"][i - 2],
  }));
  const hourStart = Math.floor(NOW / 3600000) * 3600000;
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    datetime: iso(hourStart + i * 3600000), condition: i > 9 && i < 14 ? "rainy" : "cloudy", temperature: Math.round(10 * (21 + 2 * Math.sin((i - 3) / 3.8))) / 10,
    precipitation: i > 9 && i < 14 ? 0.8 : 0, precipitation_probability: i > 9 && i < 14 ? 60 : 10, apparent_temperature: 20, cloud_coverage: i > 9 && i < 14 ? 90 : 60,
  }));

  const hass = {
    language: "en",
    locale: { language: "en", number_format: "language", time_format: "language" },
    config: { latitude: 35.6812, longitude: 139.7671, time_zone: "Asia/Tokyo", unit_system: { temperature: "°C" } },
    themes: { darkMode: dark, theme: "default" },
    entities, states,
    connection: {
      subscribeMessage(cb, msg) {
        setTimeout(() => cb({ forecast: msg.forecast_type === "daily" ? daily : hourly }), 0);
        return Promise.resolve(() => {});
      },
    },
  };

  const card = document.createElement("ha-jma-card");
  card.setConfig({ type: "custom:ha-jma-card", entity: "weather.jma_chiyoda", mode, title: mode === "full" ? "JMA Chiyoda" : "" });
  document.getElementById("host").appendChild(card);
  card.hass = hass;

  // tell a screenshot script when the card is as tall as it will get
  const report = () => { document.body.dataset.h = String(Math.ceil(card.getBoundingClientRect().height) + 32); };
  new ResizeObserver(report).observe(card);
  setTimeout(report, 1500);
})();
