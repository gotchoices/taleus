/**
 * App-shell stub. This ticket builds only the headless `core/` logic (trace indexing, nonce
 * de-anonymisation, playback state, sweep parsing); the graph view, replay controls, live-run driver and
 * sweep charts are added by the later rendering tickets, which replace this placeholder with real UI.
 *
 * It intentionally imports nothing from `core/` or the rendering libraries yet — it only proves the Vite
 * build produces a working static shell. Keep browser-only code here and in sibling UI modules; `core/`
 * stays platform-neutral and headlessly testable.
 */

function mountShell(root: HTMLElement): void {
	const heading = document.createElement('h1')
	heading.textContent = 'TallySim Viewer'
	const note = document.createElement('p')
	note.textContent = 'Core logic scaffolded; graph, replay and sweep views land in later tickets.'
	root.append(heading, note)
}

const root = document.querySelector<HTMLElement>('#app')
if (root) {
	mountShell(root)
}
