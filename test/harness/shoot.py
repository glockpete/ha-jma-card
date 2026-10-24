"""Screenshots of the card from the synthetic harness page: headless Chrome, one PNG per look, into docs/images/.

usage: python test/harness/shoot.py [name ...]     names: compact-light compact-dark full-light full-dark (default: all four)
Set CHROME to the browser's path if it is not found. Pillow is optional (it shrinks the PNGs).

Everything on the card is made up (see harness.js) except the map: the base map tiles and the newest radar frame are
fetched from their public servers, and the frame's time is read from JMA's frame list so that the radar tiles exist.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PAGE = REPO / "test" / "harness" / "index.html"
OUT = REPO / "docs" / "images"
WIDTH = {"compact": 456 + 32, "full": 1160 + 32}      # the card's width plus the page padding
FRAMES = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json"
CANDIDATES = [
    os.environ.get("CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    shutil.which("google-chrome") or "", shutil.which("chromium") or "", shutil.which("chromium-browser") or "",
]


def find_chrome():
    for c in CANDIDATES:
        if c and Path(c).exists():
            return c
    sys.exit("Chrome not found: set CHROME to its path")


def newest_frame():
    with urllib.request.urlopen(FRAMES, timeout=20) as r:
        frames = json.load(r)
    return max(f["basetime"] for f in frames if f["basetime"] == f["validtime"] and "hrpns" in f["elements"])


def shoot(chrome, profile, name, base):
    mode, theme = name.split("-")
    url = PAGE.as_uri() + f"?mode={mode}&theme={theme}&base={base}"
    common = [chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={profile}", "--virtual-time-budget=20000"]
    dom = subprocess.run([*common, f"--window-size={WIDTH[mode]},1400", "--dump-dom", url], capture_output=True, text=True, timeout=180).stdout
    m = re.search(r'data-h="(\d+)"', dom)       # the harness writes the card's height there
    height = int(m.group(1)) if m else 1000
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{name}.png"
    subprocess.run([*common, f"--window-size={WIDTH[mode]},{height}", f"--screenshot={target}", url], capture_output=True, timeout=180)
    try:
        from PIL import Image
        # the map is mostly flat greys: an adaptive 256-colour palette keeps it sharp at a third of the size
        Image.open(target).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT).save(target, optimize=True)
    except ImportError:
        pass
    print(name, f"{WIDTH[mode]}x{height}", target.stat().st_size, "bytes")


if __name__ == "__main__":
    chrome = find_chrome()
    base = newest_frame()
    print("newest radar frame", base)
    with tempfile.TemporaryDirectory() as profile:
        for n in sys.argv[1:] or ["compact-light", "compact-dark", "full-light", "full-dark"]:
            shoot(chrome, profile, n, base)
