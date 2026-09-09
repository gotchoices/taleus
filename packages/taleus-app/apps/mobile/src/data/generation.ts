/**
 * A counter that changes when everything already loaded is out of date.
 *
 * Screens read once, on mount. That is right for data that only changes when a
 * party acts — but the mock variant is not that: `?variant=empty` says "you are
 * in a different world now", and a screen that is already showing does not
 * remount just because a deep link arrived for the route it is on. Without
 * this, opening `Attention?variant=empty` while Attention is on screen changes
 * nothing at all, and the link looks dead.
 *
 * `useLoad` subscribes, so every data-backed screen re-reads when this moves.
 */
let generation = 0
const listeners = new Set<() => void>()

export function getGeneration(): number {
	return generation
}

/** Everything loaded is stale. Call when the world changes, not when data does. */
export function bumpGeneration(): void {
	generation += 1
	for (const listener of listeners) {
		listener()
	}
}

export function subscribeGeneration(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
