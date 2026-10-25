# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [semantic versioning](https://semver.org/).

## [0.13.2] - 2026-10-25

### Changed

- **Full mode order.** 台風 (typhoon) and 全国 (Japan) now come after 週間予報 (the week), so the place's next 24 hours
  come first.
- **Warning list.** Each row is a dot in JMA's level colour plus the name in ink. The filled chip is drawn once, in the
  top block.
- **Dates.** The 全国 day tabs and the weekly rows are Japanese-first ("10月25日").
- **Now tiles.** In full mode the tiles are always 3 × 3. "Observed" is a row under the tiles that names the AMeDAS
  station once, instead of a tenth tile. "Max gust today" is now "Peak gust".
- **Wide layout.** It starts at 880 px instead of 960 px, and the columns are 1.25fr : 420 px.

### Fixed

- On a phone the radar time stamp no longer overlaps the legend.
- In the wide right column "明日 00" takes two lines instead of running into the next cell.

## [0.13.1] - 2026-10-25

### Fixed

- **Installing through HACS.** HACS now takes `ha-jma-card.js` from the root of the release's source instead of the
  release asset (`content_in_root` in `hacs.json`). Since 2026-10-23 GitHub answers release-asset downloads with a
  header longer than Home Assistant's HTTP client accepts, so HACS 2.0.5 failed with "Got more than 8190 bytes when
  reading" ([hacs/integration#5643](https://github.com/hacs/integration/issues/5643)). HACS 2.0.5 still prefers a
  release asset when a release has one, so releases no longer carry one: `release.yml` only checks the version.

## [0.13.0] - 2026-10-25

First public release. The card was first written as a private dashboard card, so the version number continues from
there and the list below is the card as it stands.

### Added

- **Two modes.** `compact` is a card for a normal dashboard column; `full` shows every section open and is made for a
  panel view (from 960 px wide the radar sits on the left and the forecast on the right).
- **Now.** The weather entity's temperature, JMA's condition name in Japanese with an English gloss, the day's high
  and low, the feels-like temperature and JMA's weather icon. Temperatures follow the weather entity's
  `temperature_unit` (°C, °F or K).
- **Warnings.** Chips in JMA's warning colours, highest level first, from the warning-level sensor, and the キキクル
  risk level as a chip. A tab lists the warnings in force.
- **Notice lines**, shown only when there is something to say: tsunami, heat-stroke alert, feed problem,
  earthquake feed reconnecting, and "What to do" advice from an optional alert entity; in compact mode also a typhoon
  within 500 km and a lightning strike within 50 km. A feed that cannot be reached is never shown as "nothing in
  force".
- **Next-hour rain chart** from the 5-minute nowcast, in JMA's rain bands, with the rain outlook for the hours after.
- **Radar.** A thumbnail in compact mode. In full mode a loop with play, a scrubber, zoom presets (four by default)
  and map layers: 雨 (rain radar, last and next 60 minutes), 雨15h (1-hour rain, next 15 hours), 雷 (thunder and
  tornado nowcast, with lightning strikes), キキクル (inundation, landslide, flood), 浸水想定 (flood-hazard map) and
  衛星 (Himawari infrared). The base map is GSI's pale map by default (see **Base map** below), in a dark version
  when the Home Assistant theme is dark.
- **Base map.** The map under the radar is the pale map (淡色地図) of the Geospatial Information Authority of Japan
  (国土地理院, GSI) by default: no key, and GSI asks only for the source and a link, which the credit line carries
  (出典：国土地理院（地理院タイル）). The new `base_map` option chooses another: `osm` (OpenStreetMap standard tiles),
  `esri` (the legacy Esri World Light Gray, kept as an opt-in because Esri's terms want Esri software or an ArcGIS
  Online subscription and the item is retiring), or your own tile server as `base_map: {url, attribution, max_zoom}`
  in YAML (https only, with `{z}`, `{x}` and `{y}`). The visual editor has a select for `gsi`, `osm` and `esri`. The
  credit line shows only the base map in use. The README quotes each provider's terms under **Base map**.
- **Drop-down in compact mode** with four tabs: 警報 Warnings, 毎時 Hourly, 週間 7 days and 詳細 Details; JMA's text
  overview below. `square: true` keeps the closed card 1:1.
- **Hourly forecast** (from the weather entity; Open-Meteo, JMA's MSM model) and a **7-day list** with temperature
  range bars.
- **Details**: humidity, pressure, wind, the day's maximum gust, rain over 1 and 24 hours, sunshine, sunrise and
  sunset, the observation time and AMeDAS station, the heat index (WBGT, Ministry of the Environment) and the last
  earthquake.
- **Typhoons.** Full mode has a section with each storm's category, distance, pressure, wind and closest approach,
  and draws the track on the map at the Region and Japan zoom.
- **Nationwide forecast table** (全国) of JMA's city forecasts, and city marks on the map at the Japan zoom, in full
  mode.
- **Entities found for you.** Give the card one weather entity; it finds the other ha-jma entities of the same
  device through the entity registry. `entities:` names any of them by hand and wins. A missing optional entity hides
  only its own part of the card.
- **Optional Blitzortung lightning** (`lightning:`) and an optional alert entity (`alert_entity:`), both off until
  configured.
- **Visual editor** in the dashboard editor, and a starting configuration in the card picker that uses the first
  ha-jma weather entity.
- **Bilingual by design.** JMA's own terms stay in Japanese with an English label next to them; dates, times and
  numbers follow the Home Assistant language and time zone.
- **Theming.** Colours come from Home Assistant's theme variables, or a Material 3 theme, or `--jma-card-*`
  variables you set yourself (for example with card-mod). Light and dark follow the theme.
- **Credits on the card.** JMA's source line and its "edited" statement are always shown; Open-Meteo, 環境省,
  P2P地震情報, Blitzortung.org and the map credit are added while data from them is on screen.
- **Tests and CI.** Node's test runner (`node --test "test/*.test.cjs"`), a HACS validation workflow, a tests
  workflow and a release workflow that attaches `ha-jma-card.js` to every published release.

### Fixed

- **The card picker with no ha-jma weather entity.** The picker previews the card's starting configuration as it is,
  and with no ha-jma weather entity that is `entity: ""`, which used to show an error in the preview. `setConfig`
  now accepts exactly that empty entity and shows a one-line "Add a JMA weather entity" card; every other bad
  configuration still shows its error.

[0.13.1]: https://github.com/glockpete/ha-jma-card/releases/tag/v0.13.1
[0.13.0]: https://github.com/glockpete/ha-jma-card/releases/tag/v0.13.0
