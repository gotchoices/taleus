import { useCallback } from 'react'
import { ScrollView, Text } from 'react-native'

import { Action, Amount, Card, Failed, Loading, Options, OpenableRow } from '../components'
import { readSettings, writeSettings, type HeldUnit, type Settings as Prefs } from '../data/settings'
import { useLoad } from '../hooks/useLoad'
import { setLocale } from '../i18n'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTheme, spacing, type as typography, type Tokens } from '../theme'
import { divisorOf, setUnitStyle, unitLabel, type UnitStyle } from '../util/amount'
import type { ThemeChoice } from '../theme'

type Props = ScreenProps<'Settings'>

/**
 * Settings (story 42) — language, the unit overall figures are read in, and how
 * the app looks.
 *
 * The story's own emphasis, and this screen's shape: the choices are grouped by
 * *whether they follow the party or belong to this device*, because step 6 asks
 * for exactly that and a party setting up a second phone needs to know it before
 * they start. Everything here is a preference and nothing else — what a partner
 * may owe, and how value may move, are agreements and signed permissions, and
 * path C is explicit that they must not sit among choices about colours and
 * language. They are named at the bottom, with where they actually live, rather
 * than left out and wondered about.
 */
export function Settings({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { choice, setChoice } = useTheme()
	const { state, value, error, reload } = useLoad(useCallback(() => readSettings(), []))

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.settings.unreadable-title')} error={error} onRetry={reload} />
	}

	// A preference is applied where it is read — the i18n bundle, the amount
	// formatter, the theme provider — and stored so the next launch starts there.
	const save = (change: Partial<Prefs>) => void writeSettings(change).then(() => reload())

	const chooseLocale = (tag: string) => {
		setLocale(tag)
		save({ locale: tag })
	}
	const chooseUnitStyle = (style: UnitStyle) => {
		setUnitStyle(style)
		save({ unitStyle: style })
	}
	const chooseAppearance = (appearance: ThemeChoice) => {
		setChoice(appearance)
		save({ appearance })
	}

	const displayUnit = value.unitsHeld.find(unit => unit.denom === value.displayUnit)

	// Built here rather than in a render prop: the choice is between two forms of
	// the same figure, so both are composed once and the row picks one.
	const samples: Record<UnitStyle, React.ReactNode> = {
		mark: <Sample unit={displayUnit} unitStyle="mark" />,
		code: <Sample unit={displayUnit} unitStyle="code" />,
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.group}>{t('screens.settings.follows-you')}</Text>
			<Text style={styles.caption}>{t('screens.settings.follows-you-note')}</Text>

			<Card title={t('screens.settings.language')}>
				<Options
					options={value.availableLocales.map(locale => ({
						value: locale.tag,
						label: locale.name,
					}))}
					chosen={[value.locale]}
					onChoose={chooseLocale}
				/>
				{/* Path A: told what there is, rather than left in a half-translated app. */}
				{value.availableLocales.length === 1 ? (
					<Text style={styles.caption}>{t('screens.settings.only-language')}</Text>
				) : null}
				{/* Steps 2 and 3 — the two things language does not reach. */}
				<Text style={styles.caption}>{t('screens.settings.quoted-note')}</Text>
				<Text style={styles.caption}>{t('screens.settings.agreement-note')}</Text>
			</Card>

			<Card title={t('screens.settings.display-unit')}>
				<Options
					options={value.unitsHeld.map(unit => ({
						value: unit.denom,
						label: unitLabel(unit.denom, unit.label),
					}))}
					chosen={[value.displayUnit]}
					onChoose={denom => save({ displayUnit: denom })}
				/>
				<Text style={styles.caption}>{t('screens.settings.display-unit-note')}</Text>
				{/* Path B: a unit with no rate behind it, said plainly, with the way on. */}
				{displayUnit && !displayUnit.priced ? (
					<>
						<Text style={styles.warning}>
							{t('screens.settings.no-rate', {
								unit: unitLabel(displayUnit.denom, displayUnit.label),
							})}
						</Text>
						<Text style={styles.caption}>{t('screens.settings.no-rate-fix')}</Text>
						{/* Path B says the way forward is offered, not merely described.
						    Until this slice there was no screen to offer. */}
						<Action
							label={t('screens.settings.rates-open')}
							onPress={() => navigation.navigate('PositionTab', { screen: 'ExchangeRates' })}
							secondary
						/>
					</>
				) : null}
			</Card>

			<Card title={t('screens.settings.unit-style')}>
				<Options<UnitStyle>
					options={[
						{ value: 'mark', label: t('screens.settings.unit-style-mark') },
						{ value: 'code', label: t('screens.settings.unit-style-code') },
					]}
					chosen={[value.unitStyle]}
					onChoose={chooseUnitStyle}
					// Both forms at once: the choice is about what a figure looks like,
					// so the row shows the figure rather than describing it.
					trailing={style => samples[style]}
				/>
				<Text style={styles.caption}>{t('screens.settings.unit-style-note')}</Text>
			</Card>

			<Text style={styles.group}>{t('screens.settings.this-device')}</Text>
			<Text style={styles.caption}>{t('screens.settings.this-device-note')}</Text>

			<Card title={t('screens.settings.appearance')}>
				<Options<ThemeChoice>
					options={[
						{ value: 'system', label: t('screens.settings.appearance-system') },
						{ value: 'light', label: t('screens.settings.appearance-light') },
						{ value: 'dark', label: t('screens.settings.appearance-dark') },
					]}
					chosen={[choice]}
					onChoose={chooseAppearance}
				/>
			</Card>

			<Card>
				<OpenableRow
					onPress={() => navigation.navigate('Profile')}
					accessibilityLabel={t('screens.settings.about-me')}
				>
					<Text style={styles.body}>{t('screens.settings.about-me')}</Text>
					<Text style={styles.meta}>{t('screens.settings.about-me-note')}</Text>
				</OpenableRow>
				<OpenableRow
					onPress={() => navigation.navigate('StandingInvitation')}
					accessibilityLabel={t('screens.settings.standing-open')}
				>
					<Text style={styles.body}>{t('screens.settings.standing-open')}</Text>
					<Text style={styles.meta}>{t('screens.settings.standing-note')}</Text>
				</OpenableRow>
				<OpenableRow
					onPress={() => navigation.navigate('Notifications')}
					accessibilityLabel={t('screens.settings.notifications-open')}
				>
					<Text style={styles.body}>{t('screens.settings.notifications-open')}</Text>
					<Text style={styles.meta}>{t('screens.settings.notifications-note')}</Text>
				</OpenableRow>
			</Card>

			{/* Path C. Naming these here, with where they live, is the point: a party
			    who goes looking for them in settings must find the answer, not a gap. */}
			<Card title={t('screens.settings.not-settings')}>
				<Text style={styles.caption}>{t('screens.settings.not-settings-owe')}</Text>
				<Text style={styles.caption}>{t('screens.settings.not-settings-move')}</Text>
				<Text style={styles.caption}>{t('screens.settings.not-settings-why')}</Text>
			</Card>
		</ScrollView>
	)
}

/**
 * One hundred and eighty of the display unit, written the row's way. A round
 * whole number with a fraction, so both halves of the notation show.
 */
function Sample({
	unit,
	unitStyle,
}: {
	unit?: HeldUnit
	unitStyle: UnitStyle
}): React.JSX.Element | null {
	if (!unit) {
		return null
	}
	const divisor = divisorOf(unit)
	return (
		<Amount
			value={{ units: 180 * divisor + Math.floor(divisor / 2) }}
			unit={unit}
			unitStyle={unitStyle}
			size="small"
		/>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[2] },
	group: { ...typography.title, color: tokens.textPrimary, marginTop: spacing[2] },
	body: { ...typography.body, color: tokens.textPrimary },
	meta: { ...typography.small, color: tokens.textSecondary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	warning: { ...typography.caption, color: tokens.negative },
})
