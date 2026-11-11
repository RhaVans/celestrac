// Static asset Worker. The landing page has no runtime backend; the briefing
// form posts to VITE_BRIEFING_ENDPOINT, which is configured at build time.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request)
  },
}
