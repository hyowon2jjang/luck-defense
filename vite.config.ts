import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Dev-only endpoint that answers after a delay, used by `dev-harness.html`.
 *
 * Chrome's `--screenshot` fires on the load event, which is far too early for a
 * game that needs real seconds to reach a boss. The harness requests an image
 * from here to hold the load event open until the run has got somewhere worth
 * photographing. `--virtual-time-budget` cannot do this job: the game ticks on
 * requestAnimationFrame, which barely fires under virtual time.
 *
 * Dev server only — it is never part of a build.
 */
function holdLoadEvent(): Plugin {
  return {
    name: 'hold-load-event',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__hold', (req, res) => {
        const ms = Number(new URL(req.url ?? '', 'http://x').searchParams.get('ms') ?? 1000)
        setTimeout(() => {
          // 1x1 transparent GIF, so it is a real image load.
          const gif = Buffer.from(
            'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            'base64',
          )
          res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': gif.length })
          res.end(gif)
        }, Math.min(ms, 300_000))
      })
    },
  }
}

export default defineConfig({
  /**
   * Relative asset paths, so a build runs from wherever it is dropped.
   *
   * The default '/' hard-codes the site root into every script and style URL,
   * which breaks the moment the game is served from a subdirectory —
   * `example.com/games/meundee/` would ask for `/assets/index-x.js` and get the
   * site's 404 page. './' works at the root and in any subfolder, and costs
   * nothing, so it is the right default for a build that gets copied around.
   */
  base: './',
  plugins: [react(), holdLoadEvent()],
})
