/**
 * Mock variant selection.
 *
 * A variant names which fixture a namespace serves: `tallies.happy.json`,
 * `tallies.empty.json`, `tallies.error.json`. It arrives on a deep link
 * (`taleus://screen/TallyList?variant=empty`) and is consumed by the data
 * layer — screens never see it.
 */
import { bumpGeneration } from '../data/generation'

/**
 * `first-run` is the party having no identity yet; `naming` is the moment after
 * one exists and before it has a name — the state `ChooseName` is about, and the
 * only way a link can land there. It is deliberately not
 * `empty`: a variant name applies to every namespace at once, and a party with
 * no identity gates the whole app into onboarding — so `?variant=empty` meant
 * to show one screen's empty state would have shown first run instead.
 */
export type Variant = 'happy' | 'empty' | 'error' | 'first-run' | 'naming' | 'expired'

export const defaultVariant: Variant = 'happy'

export function isVariant(value: string): value is Variant {
	return value === 'happy' || value === 'empty' || value === 'error' || value === 'first-run' || value === 'naming' || value === 'expired'
}

let current: Variant = defaultVariant

export function getVariant(): Variant {
	return current
}

export function setVariant(value: string): void {
	if (!isVariant(value) || value === current) {
		return
	}
	current = value
	// A different variant is a different world: whatever screens are already
	// showing was read from the old one.
	bumpGeneration()
}

/** Reads `?variant=` out of a deep link, ignoring anything unrecognised. */
export function variantFromUrl(url: string): Variant | undefined {
	const match = /[?&]variant=([^&]+)/.exec(url)
	if (!match) {
		return undefined
	}
	const value = decodeURIComponent(match[1])
	return isVariant(value) ? value : undefined
}
