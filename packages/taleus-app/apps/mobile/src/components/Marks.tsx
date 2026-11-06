import { View } from 'react-native'

import { t } from '../i18n'
import { spacing, useStyles } from '../theme'
import { actMarks, type Marked } from '../util/marks'
import { Chip } from './Chip'

/**
 * The chips an act wears for where it stands (story 15), or nothing for a delivered one. `name`
 * is the counterparty's, for "Not yet with {name}".
 */
export function Marks({ act, name }: { act: Marked; name: string }): React.JSX.Element | null {
	const styles = useStyles(make)
	const marks = actMarks(act)
	if (marks.length === 0) return null
	return (
		<View style={styles.row}>
			{marks.map(mark => (
				<Chip key={mark.key} label={t(`marks.${mark.key}`, { name })} urgent={mark.urgent} />
			))}
		</View>
	)
}

const make = () => ({
	row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing[1] },
})
