import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../i18n'
import { spacing, type as typography, type Tokens } from '../theme/tokens'

/**
 * The three states every data-backed screen has to handle, in one place so they
 * read the same everywhere: waiting, unreadable, and nothing-here.
 */
export function Loading({ tokens }: { tokens: Tokens }): React.JSX.Element {
	return (
		<View style={[styles.fill, styles.centred, { backgroundColor: tokens.background }]}>
			<ActivityIndicator color={tokens.accent} />
		</View>
	)
}

export function Failed({
	tokens,
	title,
	message,
	retryable,
	onRetry,
}: {
	tokens: Tokens
	title: string
	message?: string
	retryable?: boolean
	onRetry?: () => void
}): React.JSX.Element {
	return (
		<View style={[styles.fill, styles.centred, { backgroundColor: tokens.background }]}>
			<View style={[styles.banner, { backgroundColor: tokens.bannerError }]}>
				<Text style={[typography.title, { color: tokens.textPrimary }]}>{title}</Text>
				{message ? (
					<Text style={[typography.body, { color: tokens.textSecondary, marginTop: spacing[0] }]}>
						{message}
					</Text>
				) : null}
			</View>
			{retryable && onRetry ? (
				<Pressable style={[styles.action, { backgroundColor: tokens.accent }]} onPress={onRetry}>
					<Text style={[typography.body, { color: tokens.accentText }]}>{t('common.retry')}</Text>
				</Pressable>
			) : null}
		</View>
	)
}

export function Empty({
	tokens,
	title,
	body,
	children,
}: {
	tokens: Tokens
	title: string
	body?: string
	children?: React.ReactNode
}): React.JSX.Element {
	return (
		<View style={[styles.fill, styles.centred, { backgroundColor: tokens.background }]}>
			<Text style={[typography.title, { color: tokens.textPrimary }]}>{title}</Text>
			{body ? (
				<Text
					style={[
						typography.body,
						{ color: tokens.textSecondary, textAlign: 'center', marginTop: spacing[1] },
					]}
				>
					{body}
				</Text>
			) : null}
			{children}
		</View>
	)
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
	centred: { alignItems: 'center', justifyContent: 'center', padding: spacing[3] },
	banner: { borderRadius: spacing[1], padding: spacing[3], marginBottom: spacing[3] },
	action: { borderRadius: spacing[1], paddingVertical: spacing[2], paddingHorizontal: spacing[4] },
})
