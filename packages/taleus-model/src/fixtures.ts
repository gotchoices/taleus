/**
 * Where mock fixtures come from.
 *
 * The app supplies this, not the model. React Native's bundler only includes a JSON file it can
 * see a static `require` for, so the map from fixture name to file has to be written in the app
 * that ships them. A test supplies one that reads `mock/data/` off disk instead.
 *
 * A name is a fixture file's stem -- `tallies.happy`, `party.single-device` -- exactly as the mock
 * adapters asked for it when they did their own `require`s, so every adapter's choice of which
 * file a variant serves is preserved as it was written.
 */
export type FixtureSource = (name: string) => unknown

let source: FixtureSource | undefined

/** Install the fixture source. The mock model calls this; nothing else should. */
export function setFixtureSource(next: FixtureSource): void {
	source = next
}

export function fixture(name: string): unknown {
	if (!source) {
		throw new Error(`no fixture source installed; cannot load '${name}'`)
	}
	return source(name)
}
