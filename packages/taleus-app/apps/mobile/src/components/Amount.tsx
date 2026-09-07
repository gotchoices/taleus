import { Text, type TextStyle } from 'react-native'

import { t } from '../i18n'
import { useTokens, type as typography } from '../theme'
import type { Amount as AmountValue, Perspective, Unit } from '../data/types'
import { formatAmount } from '../util/amount'

/**
 * A figure with its unit, its side, and how much it is to be trusted.
 *
 * Every screen used to call `formatAmount` and then colour the result by its
 * own rule — the list by perspective, the history by raw sign, position by row.
 * Three rules meant three chances to get it wrong, and the colour was the only
 * cue in all three. `global/ui.md` is now explicit: direction never travels by
 * colour alone, and a converted figure is marked. Both live here, once.
 */
export interface AmountProps {
	value: AmountValue
	unit: Unit
	/** When given, the figure has a side and says so in words, glyph, and colour. */
	perspective?: Perspective
	/** A figure converted into the display unit — never a signed balance. */
	estimate?: boolean
	size?: 'small' | 'body' | 'display'
	style?: TextStyle
}

const glyphs: Record<Perspective, string> = {
	'owed-to-me': '+',
	'owed-by-me': '−',
	level: '',
}

export function Amount({
	value,
	unit,
	perspective,
	estimate,
	size = 'body',
	style,
}: AmountProps): React.JSX.Element {
	const tokens = useTokens()
	const text = formatAmount(value, unit)
	const glyph = perspective ? glyphs[perspective] : ''
	const colour = !perspective
		? tokens.textPrimary
		: perspective === 'owed-to-me'
			? tokens.positive
			: perspective === 'owed-by-me'
				? tokens.negative
				: tokens.textSecondary

	const base =
		size === 'display'
			? { fontSize: 34, fontWeight: '600' as const }
			: size === 'small'
				? typography.small
				: typography.body

	return (
		<Text
			accessibilityLabel={
				perspective ? t(`amount.a11y-${perspective}`, { amount: text }) : undefined
			}
			style={[
				base,
				{ color: estimate ? tokens.textSecondary : colour, fontVariant: ['tabular-nums'] },
				estimate ? { fontStyle: 'italic' } : null,
				style,
			]}
		>
			{estimate ? '≈ ' : ''}
			{glyph}
			{text}
		</Text>
	)
}

/**
 * Which way an entry moved value, from the reading party's side. The sign on
 * `Entry.amount` is the engine's statement of direction; this names it so no
 * screen has to infer it from a colour.
 */
export function directionOf(value: AmountValue): Perspective {
	if (value.units > 0) {
		return 'owed-to-me'
	}
	return value.units < 0 ? 'owed-by-me' : 'level'
}
