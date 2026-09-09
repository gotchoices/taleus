import { Pressable, Text, View } from 'react-native'

import { useStyles, spacing, touchTarget, type as typography, type Tokens } from '../theme'

export interface Option<T extends string> {
	value: T
	label: string
	note?: string
}

/**
 * A set of choices, one or several at a time.
 *
 * Three screens in this slice pick from a list — a language, a unit, an
 * appearance, a set of partners to send a correction to — and every one of them
 * would otherwise have grown its own row with its own tick. The check sits on
 * the right and the label is the whole target, so the touch area is the row
 * rather than the glyph.
 */
export function Options<T extends string>({
	options,
	chosen,
	onChoose,
	multiple,
	trailing,
}: {
	options: readonly Option<T>[]
	chosen: readonly T[]
	onChoose(value: T): void
	/** Checkboxes rather than a radio group — what assistive technology is told. */
	multiple?: boolean
	/** Anything the row should show alongside its label, such as a live sample. */
	trailing?: (value: T) => React.ReactNode
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View accessibilityRole={multiple ? undefined : 'radiogroup'}>
			{options.map(option => {
				const checked = chosen.includes(option.value)
				return (
					<Pressable
						key={option.value}
						accessibilityRole={multiple ? 'checkbox' : 'radio'}
						accessibilityState={{ checked }}
						accessibilityLabel={option.label}
						accessibilityHint={option.note}
						android_ripple={{ borderless: false }}
						onPress={() => onChoose(option.value)}
						style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
					>
						<View style={styles.labels}>
							<Text style={styles.body}>{option.label}</Text>
							{option.note ? <Text style={styles.meta}>{option.note}</Text> : null}
						</View>
						{trailing?.(option.value)}
						{/* A radio group marks only what is chosen; a multi-select has to show
						    the unchosen ones as choices too, or it reads as a plain list. */}
						{multiple ? (
							<View style={checked ? styles.boxChecked : styles.box}>
								<Text style={styles.boxTick}>{checked ? '✓' : ''}</Text>
							</View>
						) : (
							<Text style={checked ? styles.check : styles.unchecked}>{checked ? '✓' : ''}</Text>
						)}
					</Pressable>
				)
			})}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	row: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		gap: spacing[2],
		minHeight: touchTarget,
		paddingVertical: spacing[1],
	},
	labels: { flex: 1, gap: spacing[0] },
	pressed: { opacity: 0.6 },
	body: { ...typography.body, color: tokens.textPrimary },
	meta: { ...typography.small, color: tokens.textSecondary },
	check: { ...typography.body, color: tokens.accent, width: 20, textAlign: 'right' as const },
	unchecked: { width: 20 },
	box: {
		width: 22,
		height: 22,
		borderRadius: 4,
		borderWidth: 1.5,
		borderColor: tokens.border,
		alignItems: 'center' as const,
		justifyContent: 'center' as const,
	},
	boxChecked: {
		width: 22,
		height: 22,
		borderRadius: 4,
		borderWidth: 1.5,
		borderColor: tokens.accent,
		backgroundColor: tokens.accent,
		alignItems: 'center' as const,
		justifyContent: 'center' as const,
	},
	boxTick: { ...typography.small, color: tokens.accentText, lineHeight: 16 },
})
