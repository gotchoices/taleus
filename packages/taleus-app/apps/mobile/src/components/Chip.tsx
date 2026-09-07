import { Text, View } from 'react-native'

import { useStyles, type as typography, type Tokens } from '../theme'

/**
 * A state, findable at a glance.
 *
 * `Offered`, `Closing`, and *waiting on you* were 12pt grey text inline with
 * everything else, which is invisible on a list of forty — and *waiting on you*
 * is the thing story 06 path A says a party opens the app to find. `urgent`
 * fills; everything else merely sits.
 */
export function Chip({
	label,
	urgent,
}: {
	label: string
	urgent?: boolean
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={urgent ? styles.urgent : styles.plain}>
			<Text style={urgent ? styles.urgentText : styles.plainText}>{label}</Text>
		</View>
	)
}

const make = (tokens: Tokens) => ({
	plain: {
		backgroundColor: tokens.chip,
		borderRadius: 999,
		paddingHorizontal: 8,
		paddingVertical: 2,
	},
	urgent: {
		backgroundColor: tokens.chipUrgent,
		borderRadius: 999,
		paddingHorizontal: 8,
		paddingVertical: 2,
	},
	plainText: { ...typography.small, color: tokens.textSecondary },
	urgentText: { ...typography.small, color: tokens.chipUrgentText, fontWeight: '600' as const },
})
