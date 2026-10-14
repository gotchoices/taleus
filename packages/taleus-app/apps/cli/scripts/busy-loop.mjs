/**
 * Preload (`node --import ./scripts/busy-loop.mjs`, `TALEUS_BUSY=0.7`): keeps this process's event loop
 * busy that fraction of every 100 ms, the shape of a phone whose JS thread is mostly occupied
 * (sereus's `joiner-first-commit-over-slow-relay` uses the same model). Nothing else changes.
 */
const fraction = Number(process.env.TALEUS_BUSY ?? 0)
if (fraction > 0) {
	const busyMs = Math.round(fraction * 100)
	setInterval(() => {
		const until = Date.now() + busyMs
		while (Date.now() < until) {
			// A phone's JS thread, busy elsewhere.
		}
	}, 100).unref()
}
