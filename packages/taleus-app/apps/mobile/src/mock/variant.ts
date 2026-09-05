/**
 * Mock variant selection.
 *
 * A variant names which fixture a namespace serves: `tallies.happy.json`,
 * `tallies.empty.json`, `tallies.error.json`. It arrives on a deep link
 * (`taleus://screen/TallyList?variant=empty`) and is consumed by the data
 * layer — screens never see it.
 */
export type Variant = 'happy' | 'empty' | 'error'

export const defaultVariant: Variant = 'happy'

export function isVariant(value: string): value is Variant {
	return value === 'happy' || value === 'empty' || value === 'error'
}

let current: Variant = defaultVariant

export function getVariant(): Variant {
	return current
}

export function setVariant(value: string): void {
	if (isVariant(value)) {
		current = value
	}
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
