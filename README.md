# SaaS landing page

A dark, animated marketing page for a software product: hero with a live
product mock, logo cloud, feature bento, how it works, a tabbed showcase,
metrics, testimonials, pricing with a billing toggle, FAQ, email capture and
footer. Every section is its own component and all copy lives in one file.

## Run it

```sh
bun install
bun run dev        # http://localhost:5173 (Vite + the Worker in workerd)
bun run build      # dist/client (assets) + dist/saas_landing/index.js (Worker)
```

## Edit it

- `src/content.ts` holds every string, price and link. Start there.
- `src/sections/*` are the page sections. `src/App.tsx` stacks them; delete or
  reorder lines there to remove or move a section.
- `src/styles.css` holds the design tokens (colours, radii, fonts, keyframes).
  Everything rounded is a squircle via `corner-shape`; true circles use `.round`.
  Bordered surfaces use the `depth` utility instead of a border: an inset edge
  plus a top highlight, the same treatment as the Freebuff desktop app. The
  element must be positioned; recolour the edge with `--depth-edge`.
- `src/worker/index.ts` is the Cloudflare Worker. `/api/subscribe` receives the
  email form; connect it to your provider or a D1 table.

## Deploy with Freebuff Sites

`deploy.json` already points at the build output. After `bun run build`, deploy
it with the `sites_deploy` tool (or the Sites API) from this directory.
