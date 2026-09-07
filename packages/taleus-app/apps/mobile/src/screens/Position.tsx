import { useCallback } from 'react'
import { ScrollView, Text } from 'react-native'

import { Amount, Card, Empty, Failed, Loading, Row } from '../components'
import { readPosition, type Estimate, type PerUnitPosition } from '../data/position'
import type { Perspective, Unit, UnitAmount } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { unitLabel } from '../util/amount'

/**
 * Position (story 40) — how a party is doing overall.
 *
 * Three rules the story is emphatic about, and this screen enforces: owed and
 * owing are shown separately rather than only netted — in the estimate too;
 * per-unit figures are the real ones and the cross-unit figure is an estimate
 * that both looks like one and names what it leaves out; and credit available
 * is never mixed into what the party holds.
 */
export function Position(): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => readPosition(), []))

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.position.unreadable-title')} error={error} onRetry={reload} />
	}
	if (value.perUnit.length === 0) {
		return (
			<Empty title={t('screens.position.empty-title')} body={t('screens.position.empty-body')} />
		)
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			{value.perUnit.map(unit => (
				<UnitCard key={unit.denom} position={unit} />
			))}
			{value.estimate ? <EstimateCard estimate={value.estimate} /> : null}
			{value.spendingPower ? (
				<Card
					title={t('screens.position.spending-title')}
					footnote={t('screens.position.spending-note')}
				>
					<Row
						label={t('screens.position.spending-held')}
						value={<Amount value={value.spendingPower.heldByOthers} unit={unitOf(value.spendingPower.heldByOthers)} />}
					/>
					<Row
						label={t('screens.position.spending-credit')}
						value={
							<Amount
								value={value.spendingPower.creditExtendedToMe}
								unit={unitOf(value.spendingPower.creditExtendedToMe)}
							/>
						}
					/>
				</Card>
			) : null}
		</ScrollView>
	)
}

function UnitCard({ position }: { position: PerUnitPosition }): React.JSX.Element {
	const unit: Unit = { denom: position.denom, scale: position.scale, label: position.label }
	return (
		<Card title={unitLabel(position.denom, position.label)}>
			<Row
				label={t('screens.position.owed-to-me')}
				value={<Amount value={position.owedToMe} unit={unit} perspective={sideOf(position.owedToMe.units, 'owed-to-me')} />}
			/>
			<Row
				label={t('screens.position.owed-by-me')}
				value={<Amount value={position.owedByMe} unit={unit} perspective={sideOf(position.owedByMe.units, 'owed-by-me')} />}
			/>
		</Card>
	)
}

function EstimateCard({ estimate }: { estimate: Estimate }): React.JSX.Element {
	const styles = useStyles(make)
	const unit: Unit = { denom: estimate.unit, scale: estimate.scale }
	return (
		<Card title={t('screens.position.estimate-title')}>
			{/* Story 40 step 2: owed and owing are shown separately here too, not
			    collapsed into one figure under a word the rest of the app avoids. */}
			<Row
				label={t('screens.position.estimate-owed-to-me')}
				value={<Amount value={estimate.owedToMe} unit={unit} estimate />}
			/>
			<Row
				label={t('screens.position.estimate-owed-by-me')}
				value={<Amount value={estimate.owedByMe} unit={unit} estimate />}
			/>
			<Row
				label={t('screens.position.estimate-overall')}
				value={<Amount value={estimate.net} unit={unit} estimate />}
			/>
			<Text style={styles.caption}>{t('screens.position.estimate-note')}</Text>
			{estimate.excluded.length > 0 ? (
				<Text style={styles.caption}>
					{t('screens.position.estimate-excludes', {
						units: estimate.excluded.map(item => item.label ?? item.denom).join(', '),
					})}
				</Text>
			) : null}
		</Card>
	)
}

/**
 * Zero has no side. Colouring `0.000 CHIP` red reads as a warning about
 * nothing — `ui.md` gives colour to direction, and zero has none.
 */
function sideOf(units: number, side: Perspective): Perspective {
	return units === 0 ? 'level' : side
}

/**
 * Spending-power figures carry their own unit (`UnitAmount`), so the screen has
 * one to read rather than a dollar to fall back on — `rules.md` privileges no
 * unit, and an amount arriving without one is an adapter bug.
 */
function unitOf(amount: UnitAmount): Unit {
	return { denom: amount.denom, scale: amount.scale }
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	caption: { ...typography.caption, color: tokens.textSecondary },
})
