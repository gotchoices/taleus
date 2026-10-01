/**
 * "Everything you have read is out of date."
 *
 * Not "this tally changed" -- that is a finer signal the engine will give. This is the coarse
 * one: the mock variant switched, or the engine came up over different storage. The app turns it
 * into a re-read of every screen; the model only says it happened.
 */
const listeners = new Set<() => void>()

export function onWorldChanged(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function notifyWorldChanged(): void {
	for (const listener of listeners) {
		listener()
	}
}
