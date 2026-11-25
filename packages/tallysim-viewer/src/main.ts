/**
 * App entry point: mount the viewer shell into `#app`. The shell (`app/shell.ts`) owns the DOM, the
 * load-a-network-and-draw-it path, search, and the theme toggle; the headless logic it drives lives in
 * `core/` (trace indexing) and `graph/` (model, layout, renderer). The replay controls, live-run driver and
 * sweep charts are later tickets that extend the shell's marked seams.
 */

import { mountShell } from './app/shell.js'

const root = document.querySelector<HTMLElement>('#app')
if (root) {
	mountShell(root)
}
