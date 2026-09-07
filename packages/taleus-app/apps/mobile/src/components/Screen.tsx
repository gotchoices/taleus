import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { t } from '../i18n'
import { useStyles, useTokens, spacing, type as typography, type Tokens } from '../theme'
import type { DataError } from '../data/types'
import { Action } from './Card'

/**
 * The three states every data-backed screen has to handle, in one place so they
 * read the same everywhere: waiting, unreadable, and nothing-here.
 */
export function Loading(): React.JSX.Element {
	const tokens = useTokens()
	const styles = useStyles(make)
	// Fixtures resolve in a tick; a spinner that paints and vanishes reads as a
	// flicker. Nothing at all for the first moment is calmer and just as honest.
	const [show, setShow] = useState(false)
	useEffect(() => {
		const timer = setTimeout(() => setShow(true), 150)
		return () => clearTimeout(timer)
	}, [])
	return (
		<View style={[styles.fill, styles.centred]}>
			{show ? <ActivityIndicator color={tokens.accent} /> : null}
		</View>
	)
}

export function Failed({
	title,
	error,
	onRetry,
}: {
	title: string
	error?: DataError
	onRetry?: () => void
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={[styles.fill, styles.centred]}>
			<View style={styles.banner}>
				<Text style={styles.title}>{title}</Text>
				{error?.message ? <Text style={styles.caption}>{error.message}</Text> : null}
			</View>
			{error?.retryable && onRetry ? <Action label={t('common.retry')} onPress={onRetry} /> : null}
		</View>
	)
}

export function Empty({
	title,
	body,
	children,
}: {
	title: string
	body?: string
	children?: React.ReactNode
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={[styles.fill, styles.centred]}>
			<Text style={styles.title}>{title}</Text>
			{body ? <Text style={[styles.caption, styles.centredText]}>{body}</Text> : null}
			{children}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	fill: { flex: 1, backgroundColor: tokens.background },
	centred: {
		alignItems: 'center' as const,
		justifyContent: 'center' as const,
		padding: spacing[3],
		gap: spacing[2],
	},
	centredText: { textAlign: 'center' as const },
	title: { ...typography.title, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	banner: {
		backgroundColor: tokens.bannerError,
		borderRadius: spacing[1],
		padding: spacing[3],
		gap: spacing[0],
	},
})

/** Shared surfaces, listed in `design/specs/mobile/components/index.md`. */
export const hairline = StyleSheet.hairlineWidth
