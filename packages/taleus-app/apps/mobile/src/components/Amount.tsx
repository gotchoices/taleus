import { Text, View, type TextStyle } from 'react-native'

import { t } from '../i18n'
import { useTokens } from '../theme'
import type { Amount as AmountValue, Perspective, Unit } from '../data/types'
import { amountParts, type AmountParts, type UnitNames } from '../util/amount'

/**
 * A figure with its unit, its side, and how much it is to be trusted.
 *
 * Written as a whole number and a common fraction, never with a decimal point
 * (`design/specs/domain/amounts.md`). Colour, sign, the estimate mark and the
 * spoken form all live here, once: every screen used to call a formatter and
 * then colour the result by its own rule, which is three chances to get it
 * wrong and one cue for the reader.
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

const wholeSize = { small: 12, body: 16, display: 34 } as const

/**
 * Ratios from `amounts.md`: the whole part is full size, the numerator about
 * half of it, the rule fine, and the denominator small enough to be a detail
 * rather than a distraction — legible if you look, invisible if you do not.
 */
const NUMERATOR = 0.5
const DENOMINATOR = 0.34

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
	const parts = amountParts(value, unit)
	const full = wholeSize[size]

	const colour = !perspective
		? tokens.textPrimary
		: perspective === 'owed-to-me'
			? tokens.positive
			: perspective === 'owed-by-me'
				? tokens.negative
				: tokens.textSecondary
	const ink = estimate ? tokens.textSecondary : colour

	const text: TextStyle = {
		color: ink,
		fontVariant: ['tabular-nums'],
		...(estimate ? { fontStyle: 'italic' as const } : null),
	}

	return (
		<View
			accessible
			accessibilityLabel={label(parts, perspective, estimate)}
			style={{ flexDirection: 'row', alignItems: 'center' }}
		>
			<Text style={[{ fontSize: full, fontWeight: size === 'display' ? '600' : '400' }, text, style]}>
				{estimate ? '≈ ' : ''}
				{perspective ? glyphs[perspective] : ''}
				{parts.negative && !perspective ? '−' : ''}
			</Text>

			{/* A leading mark comes before the figure, as `$` does. */}
			{parts.unit.markLeads && parts.unit.drawn === 'chip' ? (
				<ChitMark size={full} colour={ink} />
			) : null}

			<Text style={[{ fontSize: full, fontWeight: size === 'display' ? '600' : '400' }, text, style]}>
				{parts.unit.markLeads ? (parts.unit.mark ?? '') : ''}
				{parts.whole}
			</Text>

			{parts.numerator ? (
				<Fraction parts={parts} full={full} ink={ink} estimate={estimate} />
			) : null}

			{!parts.unit.markLeads && parts.unit.drawn === 'chip' ? (
				<ChitMark size={full * 0.9} colour={ink} />
			) : null}

			{!parts.unit.markLeads && !parts.unit.drawn ? (
				<Text style={[{ fontSize: full * 0.8, marginLeft: 4 }, text]}>
					{parts.unit.mark ?? parts.unit.code}
				</Text>
			) : null}
		</View>
	)
}

/**
 * Numerator on a rule, denominator beneath it. The denominator appears only
 * when the divisor is not a power of ten — where it is, the digit count already
 * says it, and `07` over `60` would be ambiguous without it.
 */
function Fraction({
	parts,
	full,
	ink,
	estimate,
}: {
	parts: AmountParts
	full: number
	ink: string
	estimate?: boolean
}): React.JSX.Element {
	const numerator = Math.round(full * NUMERATOR)
	const denominator = Math.round(full * DENOMINATOR)
	const digit: TextStyle = {
		color: ink,
		fontVariant: ['tabular-nums'],
		...(estimate ? { fontStyle: 'italic' as const } : null),
	}

	return (
		<View
			style={{
				alignItems: 'center',
				marginLeft: 2,
				// With no denominator the cluster would sit low; nudging it up puts
				// the rule near the whole part's baseline, where a fraction bar goes.
				marginBottom: parts.denominator ? 0 : Math.round(full * 0.22),
			}}
		>
			<Text style={[{ fontSize: numerator, lineHeight: Math.round(numerator * 1.1) }, digit]}>
				{parts.numerator}
			</Text>
			<View
				style={{
					alignSelf: 'stretch',
					height: Math.max(1, Math.round(full * 0.06)),
					marginVertical: 1,
					backgroundColor: ink,
				}}
			/>
			{parts.denominator ? (
				<Text style={[{ fontSize: denominator, lineHeight: Math.round(denominator * 1.15) }, digit]}>
					{parts.denominator}
				</Text>
			) : null}
		</View>
	)
}

/**
 * A CHIP: an `8` struck through with two vertical rules — the same idea as `$`
 * or `¥`, a letterform with strokes through it. Composed rather than shipped as
 * a font or an SVG, because Unicode has no double vertical overlay and a
 * composed mark scales with the text and inherits its colour.
 */
export function ChitMark({ size, colour }: { size: number; colour: string }): React.JSX.Element {
	const rule = Math.max(1, Math.round(size * 0.085))
	const gap = size * 0.2
	return (
		// The gap matters: without it the mark reads as a digit of the figure —
		// `8` then `0` looks like eighty.
		<View style={{ justifyContent: 'center', alignItems: 'center', marginLeft: size * 0.22 }}>
			<Text style={{ fontSize: size, color: colour, fontVariant: ['tabular-nums'] }}>8</Text>
			{[-gap, gap].map(offset => (
				<View
					key={offset}
					style={{
						position: 'absolute',
						width: rule,
						height: size * 1.02,
						left: '50%',
						marginLeft: offset - rule / 2,
						backgroundColor: colour,
					}}
				/>
			))}
		</View>
	)
}

function label(parts: AmountParts, perspective?: Perspective, estimate?: boolean): string {
	const spoken = parts.spoken
	if (estimate) {
		return t('amount.a11y-estimate', { amount: spoken })
	}
	return perspective ? t(`amount.a11y-${perspective}`, { amount: spoken }) : spoken
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

/** For places that can only take a string — a sentence, a label, an export. */
export function amountText(value: AmountValue, unit: Unit): string {
	return amountParts(value, unit).spoken
}

export function unitNamesFor(unit: Unit): UnitNames {
	return amountParts({ units: 0 }, unit).unit
}
