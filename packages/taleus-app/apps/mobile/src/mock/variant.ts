/**
 * Mock variant selection -- held by the mock model (package `taleus-model`).
 *
 * A variant names which fixture a namespace serves: `tallies.happy.json`,
 * `tallies.empty.json`, `tallies.error.json`. It arrives on a deep link
 * (`taleus://screen/TallyList?variant=empty`) and is consumed by the model;
 * screens never see it. Switching it tells the model the world changed, which
 * `src/data/config.ts` turns into every screen reading again.
 */
import { defaultVariant, isVariant, variantFromUrl, type Variant } from 'taleus-model'

import { mockControls } from '../data/config'

export { defaultVariant, isVariant, variantFromUrl, type Variant }

export function getVariant(): Variant {
	return mockControls().getVariant()
}

export function setVariant(value: string): void {
	mockControls().setVariant(value)
}
