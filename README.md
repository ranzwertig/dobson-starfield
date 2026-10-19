<p align="center"><img src="public/logo.svg" width="120" alt="Zenigo logo"></p>

# Zenigo

Push-to for your telescope.

A web app that works out where a Dobsonian telescope is pointing using the phone camera, then guides you to the chosen object with azimuth and altitude arrows. The phone is mounted parallel to the tube. The app detects the stars in the camera image, matches them against a star catalogue (plate solving) and converts the direction into altitude/azimuth using time and location.

Everything runs locally in the browser: no server, no sign-in. The website lives at `/` (landing page, `/getting-started/`, `/help/`, `/privacy/`, `/imprint/`), the app at `/app/` as a single HTML file of roughly 470 KB. Fonts are self-hosted, so no page contacts third parties. It is an installable web app (PWA) and works offline once it has been opened: add it to the home screen before heading out to a dark site without signal. When a new version has been deployed, the app shows a notice with an **Update** button; it can be dismissed, and the old version keeps working until you update.

## Usage

1. Serve the app over HTTPS; browsers only allow camera, GPS and motion sensors there. The repo is connected to Cloudflare: every push to `main` builds and deploys automatically (`npx wrangler deploy` runs `npm run build` first, see `wrangler.jsonc`).
2. Mount the phone firmly and parallel to the tube, start the camera and tap **Locate**. The first time, the app measures the camera's field of view and remembers it.
3. Centre a bright star in the eyepiece, tap **Eyepiece point** and tap the same star in the image. Now the app knows the offset between phone and telescope.
4. Choose a target (Sun, Moon, planets, Messier objects, bright stars) and follow the arrows, with **Continuous** for live updates. After the first solve, Continuous only checks the predicted orientation (from the last solve plus the gyroscope) against the stars, which takes milliseconds; it falls back to a full search when the prediction does not fit.

**Solve a photo from the gallery** (menu) solves saved sky photos, which is handy for testing.

**Quick settings** (top round button) holds what you change at the telescope: pointing, location with GPS, red light, camera, eyepiece point and compass correction (with one-tap reset), button labels. **Settings → Camera** can switch to another camera, e.g. a USB webcam on the tube; field of view and eyepiece point are kept per camera. **Settings → Pointing → Top edge** uses the phone's top edge as the pointer without any camera (compass and gyroscope only); the map stays upright there (zenith up, however the phone is held or rolled), and with a periscope mirror the camera image is flipped top to bottom so it matches; "I'm pointing at it" in an object's details aligns the compass on a bright star.

**Telescope and eyepieces** (Settings): telescope focal length, eyepieces (focal length, apparent field) and finder field. The map can show Telrad rings (0.5°/2°/4°) and the true field of the selected eyepiece and the finder around the crosshair; an **eyepiece view** at the bottom left shows the field as it looks in the eyepiece (zenith up, turned upside down for a Newtonian, mirrored for a star diagonal, plus a fine rotation), with the target or an arrow towards it. The selected eyepiece is in Quick settings, and "should be in the eyepiece" uses its true field.

**Deeper catalogue:** zoomed in, the map shows stars down to magnitude 9 and NGC/IC objects (about 1,900, galaxies to 12 mag, others to 11.5 mag), more the further you zoom in; large objects are drawn at their true size. They are searchable as targets ("NGC 869", "North America Nebula") and can be switched off in the filter ("Beyond Messier"). Locate still matches against the stars to magnitude 6.

**Time** (menu): show the sky at another time, slider from 12 h back to 24 h ahead, shortcuts (dark tonight, midnight, end of darkness) or any date. Map, directions, search and object details follow; a chip at the bottom left shows the time and returns to now. Locate, eyepiece point and star alignment switch back to the current time.

**Tonight** (menu) computes darkness times, Moon phase and rise/set, planets and the best Messier objects for the coming night on the device, and links one external source per topic for the current location: meteoblue (seeing and clouds), lightpollutionmap.info, Heavens-Above (ISS passes). On tablets and desktops (from 900 px width) panels open on the right instead of as bottom sheets; they float over the map, which stays in place, and the buttons move left next to them.

Without camera or photo the app shows a **sky map** from the catalogue: drag to look around, pinch (or mouse wheel, double tap) to zoom. **Align** makes the map follow the phone: before the first solve roughly via the compass (often 10° or more off near metal), after a camera solve precisely via the gyroscope, relative to the last solve. After a camera solve with Align on, the app measures how far off the compass is and offers to correct it; nothing is applied without confirmation. While a correction is active it is shown at the bottom left and can be removed with one tap (also in Settings → Compass). Solved images can be zoomed and panned too. **Filter** (menu) chooses what the map shows: presets Everything, Solar system, Deep sky and Naked eye, or individual classes (Sun/Moon/planets, stars down to a chosen magnitude, star names, constellation lines, galaxies, globular and open clusters, nebulae, planetary nebulae, drawn with the usual chart symbols). An active filter is shown at the bottom left and can be cleared with one tap. Stars, Messier objects, the Moon, planets and the Sun can be tapped for an info sheet with links to good sources: SEDS Messier Database, In-The-Sky.org and Wikipedia for Messier objects, NASA Science and Wikipedia for the Sun, Moon and planets, Wikipedia and SIMBAD for stars.

### The Sun

Selecting the Sun asks you to confirm a certified full-aperture solar filter and a covered finder first. **Never look at the Sun through a telescope or finder without a proper solar filter on the front of the telescope: it causes instant, permanent eye damage.** Plate solving does not work in daylight, so guidance to the Sun relies on compass and motion sensor. To aim without looking, turn the tube until its shadow is as small and round as possible.

## How it works

1. **Capture:** several video frames are averaged (less noise), converted to grayscale, long side at most 1280 px.
2. **Star detection** (`detectStars`): background and noise are estimated per block via median/MAD, then connected blobs above 5σ are collected. Hot pixels, elongated or ragged blobs, blobs in textured foreground, gaps in foliage and bright picture frames are rejected. Positions come from the intensity-weighted centroid.
3. **Pinhole camera model:** pixel → unit vector via the focal length in pixels.
4. **Matching:** triangles of the brightest image stars are looked up by their angular side lengths in a catalogue pair index (binary search plus neighbour lists, handedness checked). For each hit the rotation is computed with Horn's quaternion method and verified against all image stars.
5. **Unknown field of view:** a scale-free search first: triangles are compared by their side ratios within a few field-of-view bands, and a hypothesis has to be confirmed by further image stars before it is verified. Only if that fails, the search steps through 12–90° in 2.5 % steps. The limiting magnitude of the index adapts to the field of view.
6. **Continuous mode:** with a recent solution, the orientation is predicted (last solve plus gyroscope rotation since then) and the detected stars are matched with shrinking search radii; the camera model stays fixed. No triangle search is needed.
7. **Refinement:** focal length, radial distortion and, with enough stars, a polynomial correction (like SIP) by least squares, with outlier rejection.
8. **Guarding against false matches:** residuals below about 1.6 px, a cross-check of the brightest stars, rank correlation of brightness, and at least 10 matching stars when the field of view is unknown.
9. **Navigation:** [Astronomy Engine](https://github.com/cosinekitty/astronomy) converts from J2000 to the horizon frame (including precession, nutation, refraction) and provides positions of the Sun, Moon and planets.
10. **Motion sensors:** movement comes from the relative orientation (gyroscope), smoothed with quaternions and with jumps rejected; the compass only contributes a north offset (time-based filter with a 4 s time constant, short disturbances ignored), plus the compass correction if the user accepted one.
11. **Rendering:** the canvas is only redrawn when the view changes by more than a fraction of a pixel (always for live video); time-dependent sky data (horizon rotation, Sun, Moon, planets) is computed at most once per second.

## Layout

| Path | Contents |
|---|---|
| `src/app.html` | UI, camera, overlay, sky map, navigation |
| `src/solver.js` | star detection and plate solver (also usable in Node) |
| `src/sw.js` | service worker of the app (`/app/sw.js`): offline use and update notices, version set by the build |
| `src/sw-root.js` | retires the old service worker at `/sw.js` from when the app lived at `/` |
| `site/` | website: landing page, getting started, help, privacy policy, imprint, 404 page, shared `_header.html`/`_footer.html`, `site.css` |
| `scripts/hero.mjs` | draws the landing page star chart from the catalogue at build time |
| `public/` | static files copied to `dist/`: `app/` logo, web app manifest and icons, `robots.txt` |
| `scripts/icons.cjs` | renders the PNG icons from `public/app/logo.svg` (needs Playwright; only after logo changes) |
| `scripts/catalog.mjs` | generates `src/data.js` from d3-celestial: stars to magnitude 6 (also used by the solver), names, designations, Messier objects with sizes, constellation lines; plus `public/app/deep-stars.bin` (78,000 stars 6–9 mag, 7 bytes each) and `public/app/dso.json` (about 1,900 NGC/IC and other deep-sky objects), loaded after start and precached for offline use |
| `scripts/build.mjs` | builds the website and `dist/app/index.html` with Astronomy Engine, catalogue and solver inlined, copies the fonts |
| `scripts/image_to_f32.py` | converts a photo for `test/photo.cjs` |
| `test/synthetic.cjs` | synthetic star fields with a known solution |
| `test/photo.cjs` | solves a real photo |

`dist/` and `src/data.js` are generated by the build and not checked in.

## Build and test

Node 20 or newer.

```bash
npm install
npm run build        # -> dist/: website, app/, fonts/
npm test             # synthetic star fields
npm run dev          # local server via wrangler dev
npm run deploy       # manual deploy (otherwise on push to main)
```

Testing a real photo (needs Python with Pillow and NumPy):

```bash
python3 scripts/image_to_f32.py photo.jpg /tmp/photo
npm run test:photo -- /tmp/photo
```

## Known limitations

- Not yet tested under a real sky with the live camera. Whether the browser's video exposure catches enough stars depends heavily on the phone.
- Without a known field of view the app needs at least 10 matching stars, so very sparse images are rejected rather than solved wrongly.
- The first solve with an unknown field of view usually takes 0.3–3 s, narrow fields (around 20°) up to about 10 s.
- The catalogue goes to magnitude 6, so fields narrower than about 10° (through a finder or eyepiece) cannot be solved.

## Third-party code and data

- Star catalogue, names, Messier data and constellation lines: [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn, BSD-3-Clause
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) by Don Cross, MIT
