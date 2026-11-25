import { defineConfig } from 'vite'

/**
 * Static, server-less build. `base: './'` emits **relative** asset URLs so the produced `dist/` can be
 * served from any path (a subfolder on a static host, or opened locally) without a rewrite step — the
 * viewer is a dev tool that may later be published to the web as a plain static bundle. Rendering deps
 * (graphology / sigma / uPlot) are wired in by the later rendering tickets; this config only needs to
 * build the app shell today.
 */
export default defineConfig({
	base: './',
	build: {
		outDir: 'dist',
		emptyOutDir: true,
	},
})
