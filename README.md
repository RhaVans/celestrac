# Celestrac

Landing page for Celestrac, an intelligence and hardware company. One fixed
WebGL scene carries six chapters: a procedurally generated planet, orbital
tracks, an exploded sensor satellite, and civil/defense overlays. The page
falls back to stacked, readable sections when JavaScript or WebGL is absent.

## Run

```sh
npm install
npm run dev        # Vite dev server
npm run build      # typecheck + production build in dist/
npm run preview    # serve the production build
```

`npm run build` runs `tsc --noEmit` first, so type errors fail the build.

## Briefing form

Copy `.env.example` to `.env` and set the POST endpoint:

```sh
VITE_BRIEFING_ENDPOINT=https://example.com/briefings
```

The form sends JSON: `name`, `organization`, `email`, `message`.

- Development with no endpoint: a 600ms mock success.
- Production with no endpoint: the explicit error state with Retry.
- Any non-2xx response or network failure: the error state with Retry.

There is no backend in this repository; `worker/index.js` only serves the
built static assets for hosting.

## Tuning the 3D tiers

Counts and DPR caps live in `src/scene/quality.ts`.

- High tier: 50k stars, 22k globe points, 7 orbit lines, 16 satellites.
- Low tier: 16k stars, 9k globe points, 5 orbit lines, 10 satellites.
- Initial tier comes from `hardwareConcurrency`, `devicePixelRatio` and pointer
  type. If the mean frame time exceeds 24ms across 60 frames, the scene drops
  its pixel ratio to 1 and draws the low-tier counts once.

Camera poses per chapter and layout live in `src/scene/scene.ts`. Per-object
geometry is in `src/scene/sky.ts`, `globe.ts`, `orbits.ts`, `hardware.ts` and
`overlays.ts`.

## Copy and layout

All copy is static, semantic HTML in `index.html`, in reading order. The design
tokens (Starry Night palette, type, gutters) are CSS custom properties at the
top of `src/styles.css`. Motion is in `src/main.ts`, driven by one scrubbed GSAP
timeline.
