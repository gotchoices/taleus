import { Text, TextInput, View } from 'react-native'

import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'

/**
 * A labelled text field.
 *
 * Six earlier screens each grew their own copy of this — same styling, four
 * different wrappers — and this is the one worth keeping. Those six are not
 * migrated here; that is a pass of its own, recorded in `design/STATUS.md`.
 */
export function Input({
	label,
	note,
	...props
}: { label: string; note?: string } & React.ComponentProps<typeof TextInput>): React.JSX.Element {
	const styles = useStyles(make)
	const tokens = useTokens()
	return (
		<View style={styles.field}>
			<Text style={styles.body}>{label}</Text>
			<TextInput
				accessibilityLabel={label}
				placeholderTextColor={tokens.textSecondary}
				style={styles.input}
				{...props}
			/>
			{note ? <Text style={styles.caption}>{note}</Text> : null}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	field: { gap: spacing[1] },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	input: {
		...typography.body,
		color: tokens.textPrimary,
		backgroundColor: tokens.surfaceAlt,
		borderRadius: spacing[1],
		borderWidth: 1,
		borderColor: tokens.border,
		minHeight: touchTarget,
		paddingHorizontal: spacing[2],
	},
})
