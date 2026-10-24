The harness runs ha-jma-card in a plain browser with made-up data, for the pictures in docs/images/.

  index.html   the page; sets the light or dark variables of Home Assistant's default themes
  harness.js   a made-up hass: Chiyoda, Tokyo (Tokyo Station, 35.6812 N 139.7671 E); every reading is invented
  shoot.py     headless Chrome, one PNG per look:  python test/harness/shoot.py

Open index.html?mode=full&theme=dark in a browser to look at it. Query: mode=compact|full, theme=light|dark,
sun=above|below, base=<newest observed radar frame, UTC, YYYYMMDDhhmmss>. The map and radar tiles come from their
public servers; without a base the radar shows the map only.

node --test "test/*.test.cjs" covers the page (test/harness-page.test.cjs) but does not take the pictures.
