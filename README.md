# Celestrac

Landing page for Celestrac: Orrery (the intelligence platform), Tycho (the
orbital sensor satellite) and Sextant (the ground terminal). Vite, TypeScript,
three.js, GSAP and Lenis, with one fixed WebGL scene behind two pinned stages and
a real product frame built in DOM plus a 2D canvas.

The design direction — tokens, type, drafting rules and motion budget — lives in
[DESIGN.md](DESIGN.md). Build from that file.

## Run

```sh
npm install
npm run dev        # Vite dev server
npm run build      # poster → typecheck → dist/
npm run preview    # serve the production buildnpm run audit       # rules in scripts/audit.mjs against dist/
npm run verify      # screenshots + measurements, needs a served page
npm run keyboard    # keyboard paths through the Orrery and the toggle
```

`npm run build` renders `public/poster.png` first, then typechecks, then builds.

## What is where

| Path | Role |
| --- | --- |
| `index.html` | All copy and semantics: hero, Orrery frame, Tycho, products, missions, contact. |
| `src/main.ts` | Chrome, Lenis, ScrollTriggers, menu, mission toggle, form, lazy scene boot. |
| `src/orrery.ts` | Track table, 2D map canvas and detail drawer. |
| `src/orrery-data.ts` | Deterministic 40-track sample set. |
| `src/land.ts` | Natural Earth 110m coastlines shared by the globe, map and poster. |
| `src/scene/` | Sky, globe, Keplerian orbits, Tycho, overlays, drafting overlay, scene. |
| `scripts/poster.mjs` | Build-time poster renderer (no browser, no native image dependency). |
| `scripts/audit.mjs` | Build-output audit. |

## Tycho model

`src/scene/hardware.ts` exports `HARDWARE_GLB = '/models/tycho.glb'`. Drop a real
model at `public/models/tycho.glb` and it replaces the procedural object; the
drafting anchors then come from the model's bounds. Sourcing one real,
well-made GLB (with KTX2 textures) is the single largest remaining quality
upgrade. Nothing is fetched when the file is absent.

## Performance

- Three and the scene load through `import()` after first paint. The poster is
  the first frame and the LCP element is the HTML headline.
- Initial JS is capped at 250 kB gzipped by the audit; three is a separate chunk.
- Orrery initialises when its frame approaches the viewport.
- Low tier or save-data keeps the hero live and shows the poster frame for the
  reading sections (`html[data-tier="low"].is-reading`).
- DPR caps live in `src/scene/quality.ts`; one downgrade happens if the mean
  frame time exceeds 24 ms across 60 frames.
- `?debug=1` shows draw calls, triangles, frame time and tier, and turns amber
  above 100 draw calls.

## Briefing form

Copy `.env.example` to `.env` and set `VITE_BRIEFING_ENDPOINT`. The form posts
JSON `{ name, organization, email, message }`.

- Development with no endpoint: a 600 ms mock success.
- Production with no endpoint: explicit error state with Retry.
- Non-2xx or network failure: the same error state.

`worker/index.js` only serves the built assets; there is no backend here.

## Audit

`npm run audit` fails on emoji, the banned hype list, any font family other than
Archivo and IBM Plex Mono, `text-transform: uppercase` outside `.annot`,
`backdrop-filter`, CSS gradients, and initial JS over 250 kB gzipped. The
draw-call rule reads `artifacts/drawcalls.json` from the verification run and is
reported as skipped when that file is absent.

## Verification

`npm run verify` starts Chromium itself and attaches over CDP, then screenshots
every stage at 390x844, 768x1024, 1440x900 and 1920x1080 into `artifacts/v2/`
and asserts:

- no horizontal scroll and no console errors at any viewport;
- every sampled text colour meets 4.5:1, or 3:1 for large text;
- ground + surface cover at least 90% and data stays under 5% in every shot;
- the WebGL scene actually attached, and the tier it chose;
- draw calls in the `?debug=1` overlay stay inside the cap.

It writes `artifacts/verify-report.json` with the per-shot colour shares and
`artifacts/drawcalls.json` for the audit's draw-call rule. Run it against the dev
server (`BASE_URL=http://127.0.0.1:3000 npm run verify`): the `?debug=1` stats
overlay is stripped from production builds, so a preview build reports no draw
calls.

Chromium needs system libraries and a font manager. On a desktop,
`npx playwright install chromium` is enough. On a bare container without root,
extract the debs and point the environment at them:

```sh
apt-get -o Dir::State::lists=/tmp/apt/lists -o Dir::Cache=/tmp/apt/cache \
  -o Dir::Etc::sourcelist=/tmp/apt/sources.list update
apt-get download libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
  libcups2t64 libxkbcommon0 libasound2t64 libcairo2 libpango-1.0-0 \
  libatspi2.0-0t64 libgbm1 libfontconfig1 libfreetype6 fonts-dejavu-core
for f in *.deb; do dpkg-deb -x "$f" /tmp/chromium-libs; done
export LD_LIBRARY_PATH=/tmp/chromium-libs/usr/lib/x86_64-linux-gnu
export FONTCONFIG_PATH=/tmp/chromium-libs/etc/fonts
```

Without a font manager Skia aborts in `SkFontMgr_FontConfigInterface` and the
browser dies on the first text render, which looks like an unrelated launch
failure.

Both scripts start Chromium through `scripts/chromium.mjs`, which owns the
process and exposes CDP; see the header of that file for why.

## Keyboard paths

`npm run keyboard` drives the interactive parts with real key presses and
asserts, writing `artifacts/keyboard-report.json`:

- rows are focusable, and Tab / Shift+Tab / ArrowUp / ArrowDown move between
  them in order, previewing without selecting;
- Enter and Space select, Escape closes the drawer and keeps focus on the row;
- Escape also closes when focus sits in the drawer or on nothing at all;
- the drawer's close control is reachable only while a track is selected;
- the mission toggle is a roving tab stop: arrows move and wrap, Home / End
  jump, and Tab leaves the group;
- PageDown still scrolls, and no console errors appear during the pass.

The pass then repeats at 390x844, where the drawer becomes a bottom sheet:

- closed, it is a fixed plate that is `visibility: hidden` and takes no focus;
- opening it moves focus to its close button, and locks the page (the sheet owns
  PageDown / arrows / Home / End, including against the page's section nav);
- Escape closes it, unlocks the page, and returns focus to the track row;
- as a sheet it is `role="dialog"` with `aria-modal="true"`, its accessible name
  is the track id plus type, Tab is trapped inside it, and closing restores the
  plain `aria-live="polite"` inline panel used on desktop.

## Fonts

Archivo variable (latin, width + weight axes) and IBM Plex Mono are self-hosted
from `public/fonts`, both OFL. Font declarations live only in `src/fonts.css` so
a licensed neutral grotesk can replace Archivo in one file.
