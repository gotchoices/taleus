import { Pressable, Text, View } from 'react-native'

import { useStyles, spacing, touchTarget, type as typography, type Tokens } from '../theme'

/** A titled block. The card vocabulary TallyView and Position both invented. */
export function Card({
	title,
	children,
	footnote,
}: {
	title?: string
	children: React.ReactNode
	footnote?: string
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.card}>
			{title ? <Text style={styles.cardTitle}>{title}</Text> : null}
			{children}
			{footnote ? <Text style={styles.caption}>{footnote}</Text> : null}
		</View>
	)
}

/** Label on the left, value on the right, an optional note beneath the label. */
export function Row({
	label,
	note,
	value,
}: {
	label: string
	note?: string
	value?: React.ReactNode
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.row}>
			<View style={styles.rowLabel}>
				<Text style={styles.body}>{label}</Text>
				{note ? <Text style={styles.meta}>{note}</Text> : null}
			</View>
			{typeof value === 'string' ? <Text style={styles.body}>{value}</Text> : value}
		</View>
	)
}

/**
 * A row that opens something. The chevron is the affordance `global/ui.md`
 * requires; nothing that is not tappable wears one.
 */
export function OpenableRow({
	onPress,
	accessibilityLabel,
	children,
}: {
	onPress: () => void
	accessibilityLabel?: string
	children: React.ReactNode
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			android_ripple={{ borderless: false }}
			onPress={onPress}
			style={({ pressed }) => [styles.openable, pressed ? styles.pressed : null]}
		>
			<View style={styles.openableBody}>{children}</View>
			<Text style={styles.chevron}>{'›'}</Text>
		</Pressable>
	)
}

/** A primary action. Meets the platform touch minimum whatever the text size. */
export function Action({
	label,
	onPress,
	secondary,
}: {
	label: string
	onPress?: () => void
	secondary?: boolean
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			android_ripple={{ borderless: false }}
			style={({ pressed }) => [
				secondary ? styles.secondaryAction : styles.action,
				pressed ? styles.pressed : null,
			]}
		>
			<Text style={secondary ? styles.secondaryActionText : styles.actionText}>{label}</Text>
		</Pressable>
	)
}

const make = (tokens: Tokens) => ({
	card: {
		backgroundColor: tokens.surfaceAlt,
		borderRadius: spacing[1],
		padding: spacing[3],
		gap: spacing[1],
	},
	cardTitle: { ...typography.small, color: tokens.textSecondary },
	row: {
		flexDirection: 'row' as const,
		justifyContent: 'space-between' as const,
		alignItems: 'flex-start' as const,
		gap: spacing[2],
		minHeight: 28,
	},
	rowLabel: { flexShrink: 1 },
	openable: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		gap: spacing[2],
		minHeight: touchTarget,
		paddingVertical: spacing[2],
		paddingHorizontal: spacing[3],
		borderBottomWidth: 0.5,
		borderBottomColor: tokens.border,
	},
	openableBody: { flex: 1, gap: spacing[0] },
	pressed: { opacity: 0.6 },
	chevron: { fontSize: 22, color: tokens.textSecondary },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	meta: { ...typography.small, color: tokens.textSecondary },
	action: {
		backgroundColor: tokens.accent,
		borderRadius: spacing[1],
		minHeight: touchTarget,
		justifyContent: 'center' as const,
		alignItems: 'center' as const,
		paddingHorizontal: spacing[4],
	},
	actionText: { ...typography.body, color: tokens.accentText },
	secondaryAction: {
		minHeight: touchTarget,
		justifyContent: 'center' as const,
		alignItems: 'center' as const,
		paddingHorizontal: spacing[4],
	},
	secondaryActionText: { ...typography.body, color: tokens.accent },
})
