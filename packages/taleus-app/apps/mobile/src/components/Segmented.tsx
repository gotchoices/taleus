import { Pressable, Text, View } from 'react-native'

import { useStyles, spacing, touchTarget, type as typography, type Tokens } from '../theme'

export interface Segment<T extends string> {
	value: T
	/** Short enough to sit in a row of three. */
	label: string
	/** What assistive technology says, where the short label is too terse. */
	spoken?: string
}

/**
 * One choice from a few, in a row rather than a column.
 *
 * `Options` is right when each choice needs a sentence of its own. When the same
 * three-way choice repeats down a screen — one per kind of notice — a column
 * turns a small table into four screens of scrolling, and the reader loses the
 * comparison the table was for.
 */
export function Segmented<T extends string>({
	segments,
	chosen,
	onChoose,
	label,
}: {
	segments: readonly Segment<T>[]
	chosen: T
	onChoose(value: T): void
	/** Names the group for assistive technology — "Something arrived". */
	label?: string
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row}>
			{segments.map(segment => {
				const selected = segment.value === chosen
				return (
					<Pressable
						key={segment.value}
						accessibilityRole="radio"
						accessibilityState={{ checked: selected }}
						accessibilityLabel={segment.spoken ?? segment.label}
						android_ripple={{ borderless: false }}
						onPress={() => onChoose(segment.value)}
						style={({ pressed }) => [
							styles.segment,
							selected ? styles.selected : null,
							pressed ? styles.pressed : null,
						]}
					>
						<Text
							style={selected ? styles.selectedText : styles.text}
							numberOfLines={1}
							// The label must stay readable at large text sizes rather than
							// being clipped to fit a box the design chose.
							adjustsFontSizeToFit
							minimumFontScale={0.8}
						>
							{segment.label}
						</Text>
					</Pressable>
				)
			})}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	row: {
		flexDirection: 'row' as const,
		borderRadius: spacing[1],
		borderWidth: 1,
		borderColor: tokens.border,
		overflow: 'hidden' as const,
	},
	segment: {
		flex: 1,
		minHeight: touchTarget,
		alignItems: 'center' as const,
		justifyContent: 'center' as const,
		paddingHorizontal: spacing[1],
	},
	selected: { backgroundColor: tokens.accent },
	pressed: { opacity: 0.6 },
	text: { ...typography.small, color: tokens.textPrimary, textAlign: 'center' as const },
	selectedText: { ...typography.small, color: tokens.accentText, textAlign: 'center' as const },
})
