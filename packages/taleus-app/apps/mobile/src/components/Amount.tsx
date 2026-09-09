import { Text, View, type TextStyle } from 'react-native'

import { t } from '../i18n'
import { useTokens } from '../theme'
import type { Amount as AmountValue, Perspective, Unit } from '../data/types'
import { amountParts, unitFace, type AmountParts, type UnitNames, type UnitStyle } from '../util/amount'
import { ChitMark } from './ChitMark'

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
	/**
	 * Overrides the party's own mark-or-code preference. Only the screen that
	 * offers that choice needs this — it has to show both forms at once.
	 */
	unitStyle?: UnitStyle
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
	unitStyle,
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
			{estimate ? (
				<Text style={[{ fontSize: full }, text, style]}>{'≈ '}</Text>
			) : null}

			{/*
			 * The unit leads, always — whatever it is and whatever the locale would
			 * do with a currency symbol. On a list where dollars, CHIP and someone's
			 * hours sit in adjacent rows, what a figure counts matters before how
			 * much it is, and one position for every unit beats two.
			 */}
			<UnitFace
				names={parts.unit}
				full={full}
				ink={ink}
				text={text}
				style={style}
				unitStyle={unitStyle}
			/>

			<Text
				style={[
					{ fontSize: full, fontWeight: size === 'display' ? '600' : '400', marginLeft: full * 0.2 },
					text,
					style,
				]}
			>
				{perspective ? glyphs[perspective] : ''}
				{parts.negative && !perspective ? '−' : ''}
				{parts.whole}
			</Text>

			{parts.numerator ? (
				<Fraction parts={parts} full={full} ink={ink} estimate={estimate} />
			) : null}
		</View>
	)
}

/**
 * The unit, mark or code by the reader's preference (`amounts.md`; story 42).
 * CHIP's mark is drawn rather than typed, so under the code preference it falls
 * back to the letters like any other unit.
 */
function UnitFace({
	names,
	full,
	ink,
	text,
	style,
	unitStyle,
}: {
	names: UnitNames
	full: number
	ink: string
	text: TextStyle
	style?: TextStyle
	unitStyle?: UnitStyle
}): React.JSX.Element {
	const face = unitFace(names, unitStyle)
	if (face.drawn === 'chip') {
		return <ChitMark size={full * 0.95} colour={ink} />
	}
	return <Text style={[{ fontSize: full * 0.82 }, text, style]}>{face.text}</Text>
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
