import { useCallback, useState } from 'react'
import { I18nManager, ScrollView, Text, View } from 'react-native'

import { Action, Amount, Card, Chip, Failed, Input, Loading, Options, Row } from '../components'
import {
	clearRate,
	isStale,
	readRates,
	setRate,
	type Conversion,
	type Rate,
	type RatesPage,
} from '../data/rates'
import type { HeldUnit } from '../data/settings'
import type { DataError, Unit } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { divisorOf, unitLabel } from '../util/amount'
import { formatInstant } from '../util/date'

/** What the party is filling in, before any of it is signed. */
interface Draft {
	unit: Unit
	basis: 'fixed' | 'source'
	accept: string
	part: string
	margin: string
	permitsMovement: boolean
	existing?: Rate
}

/**
 * ExchangeRates (story 41) — what each unit is worth to this party.
 *
 * The story is only half about setting a number. The other half is what setting
 * one *means*: a rate is not a display preference but the price value actually
 * converts at through this party, standing until they change it, against people
 * who may be watching that market far more closely. So the screen says what a
 * rate enables, what it exposes them to, and how to limit that — alongside how
 * to set it, never after.
 *
 * Taleus has no opinion of its own about what anything is worth, and the screen
 * never presents a figure as a market or a true value.
 */
export function ExchangeRates(): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => readRates(), []))
	const [draft, setDraft] = useState<Draft | undefined>()
	const [failure, setFailure] = useState<DataError | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.rates.unreadable-title')} error={error} onRetry={reload} />
	}

	const against: Unit = { denom: value.against, scale: 2 }
	const divisor = divisorOf(against)

	const begin = (unit: Unit, existing?: Rate) =>
		setDraft({
			unit,
			basis: existing?.basis ?? (unit.denom === 'CHIP' ? 'source' : 'fixed'),
			accept: existing ? String(existing.accept / divisor) : '',
			part: existing ? String(existing.part / divisor) : '',
			margin: existing?.marginPercent === undefined ? '' : String(existing.marginPercent),
			permitsMovement: existing?.permitsMovement ?? false,
			existing,
		})

	const sign = async (current: Draft) => {
		setFailure(undefined)
		const accept = Math.round(Number(current.accept || '0') * divisor)
		const part = Math.round(Number(current.part || current.accept || '0') * divisor)
		const result = await setRate({
			...current.unit,
			basis: current.basis,
			accept,
			part,
			source: current.existing?.source,
			marginPercent: current.basis === 'source' ? Number(current.margin || '0') : undefined,
			signed: new Date().toISOString(),
			updated: new Date().toISOString(),
			permitsMovement: current.permitsMovement,
			widelyTraded: current.existing?.widelyTraded,
			circleOnly: current.existing?.circleOnly,
		})
		if (!result.ok) {
			setFailure(result.error)
			return
		}
		setDraft(undefined)
		reload()
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card>
				<Text style={styles.caption}>{t('screens.rates.private')}</Text>
				{/* Path C: a rate is the party's own valuation, and the app never
				    supplies one or dresses one up as a market figure. */}
				<Text style={styles.caption}>{t('screens.rates.no-opinion')}</Text>
			</Card>

			{value.unpriced.length === 0 && value.rates.length === 0 ? (
				<Card>
					<Text style={styles.body}>
						{t('screens.rates.nothing-to-price', { unit: unitLabel(value.against) })}
					</Text>
				</Card>
			) : null}

			{/* Step 1: shown that they sit outside everything else, and why. */}
			{value.unpriced.map(unit =>
				draft?.unit.denom === unit.denom ? (
					<Editor
						key={unit.denom}
						draft={draft}
						failure={failure}
						onChange={setDraft}
						onSign={() => void sign(draft)}
						onCancel={() => setDraft(undefined)}
					/>
				) : (
					<Unpriced key={unit.denom} unit={unit} onPrice={() => begin(unit)} />
				),
			)}

			{value.rates.map(rate =>
				draft?.unit.denom === rate.denom ? (
					<Editor
						key={rate.denom}
						draft={draft}
						failure={failure}
						onChange={setDraft}
						onSign={() => void sign(draft)}
						onCancel={() => setDraft(undefined)}
					/>
				) : (
					<Priced
						key={rate.denom}
						rate={rate}
						against={against}
						onChange={() => begin(rate, rate)}
						onStop={() => void clearRate(rate.denom).then(() => reload())}
					/>
				),
			)}

			<Converted page={value} />
		</ScrollView>
	)
}

function Unpriced({ unit, onPrice }: { unit: HeldUnit; onPrice: () => void }): React.JSX.Element {
	const styles = useStyles(make)
	const label = unitLabel(unit.denom, unit.label)
	return (
		<Card title={t('screens.rates.unpriced')}>
			<Text style={styles.body}>{label}</Text>
			<Text style={styles.caption}>{t('screens.rates.unpriced-why', { unit: label })}</Text>
			{/* Path E: holding something you cannot price is a coherent state, and
			    the screen says so rather than nagging. */}
			<Text style={styles.caption}>{t('screens.rates.unpriced-fine')}</Text>
			<Action label={t('screens.rates.price-it')} onPress={onPrice} />
		</Card>
	)
}

function Priced({
	rate,
	against,
	onChange,
	onStop,
}: {
	rate: Rate
	against: Unit
	onChange: () => void
	onStop: () => void
}): React.JSX.Element {
	const styles = useStyles(make)
	const label = unitLabel(rate.denom, rate.label)
	const stale = isStale(rate)

	return (
		<Card title={label}>
			{/* Both directions, because the story asks about both and they differ. */}
			<Row
				label={t('screens.rates.accept')}
				value={<Amount value={{ units: rate.accept }} unit={against} />}
			/>
			<Row
				label={t('screens.rates.part')}
				value={<Amount value={{ units: rate.part }} unit={against} />}
			/>
			<Text style={styles.caption}>{t('screens.rates.direction-note')}</Text>
			<Text style={styles.caption}>{t('screens.rates.conservative')}</Text>

			<Text style={styles.meta}>
				{rate.basis === 'source' && rate.source
					? t('screens.rates.basis-source', { source: rate.source.name })
					: t('screens.rates.basis-fixed')}
			</Text>
			{rate.basis === 'source' && rate.marginPercent !== undefined ? (
				<Text style={styles.meta}>{t('screens.rates.margin', { margin: rate.marginPercent })}</Text>
			) : null}
			<Text style={styles.meta}>
				{rate.basis === 'source'
					? t('screens.rates.signed-instruction', { date: formatInstant(rate.signed) })
					: t('screens.rates.signed-fixed', { date: formatInstant(rate.signed) })}
			</Text>

			{/* The story's error cases, both of which leave value converting at
			    something the party may not have looked at lately. */}
			{rate.source && !rate.source.reachable ? (
				<Text style={styles.warning}>
					{t('screens.rates.source-unreachable', {
						source: rate.source.name,
						date: formatInstant(rate.source.lastFetched),
					})}
				</Text>
			) : null}
			{stale ? (
				<>
					<Chip label={t('screens.rates.stale', { date: formatInstant(rate.updated) })} urgent />
					<Text style={styles.caption}>{t('screens.rates.stale-note')}</Text>
				</>
			) : null}

			<Text style={styles.heading}>{t('screens.rates.enables')}</Text>
			<Text style={styles.caption}>{t('screens.rates.enables-figures')}</Text>
			{rate.permitsMovement ? (
				<Text style={styles.caption}>{t('screens.rates.enables-movement', { unit: label })}</Text>
			) : (
				// Path D: valuing a unit and permitting movement across it are
				// separate decisions, and this party made only the first.
				<Text style={styles.caption}>{t('screens.rates.figures-only')}</Text>
			)}
			<Text style={styles.caption}>{t('screens.rates.movement-lives')}</Text>

			<Text style={styles.caption}>{t('screens.rates.scope', { unit: label })}</Text>

			{/* Path G, and path F for the case where none of it applies. */}
			{rate.widelyTraded ? (
				<View style={styles.warningBlock}>
					<Text style={styles.heading}>{t('screens.rates.market-position')}</Text>
					<Text style={styles.caption}>
						{t('screens.rates.market-position-body', { unit: label })}
					</Text>
					<Text style={styles.caption}>{t('screens.rates.limit-how')}</Text>
				</View>
			) : null}
			{rate.circleOnly ? (
				<Text style={styles.caption}>{t('screens.rates.circle', { unit: label })}</Text>
			) : null}

			<View style={styles.actions}>
				<Action label={t('screens.rates.stop')} onPress={onStop} secondary />
				<Action label={t('screens.rates.change')} onPress={onChange} />
			</View>
		</Card>
	)
}

function Editor({
	draft,
	failure,
	onChange,
	onSign,
	onCancel,
}: {
	draft: Draft
	failure?: DataError
	onChange(next: Draft): void
	onSign(): void
	onCancel(): void
}): React.JSX.Element {
	const styles = useStyles(make)
	const label = unitLabel(draft.unit.denom, draft.unit.label)
	const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })

	return (
		<Card title={t('screens.rates.editing', { unit: label })}>
			<Text style={styles.heading}>{t('screens.rates.basis-question')}</Text>
			<Options<'fixed' | 'source'>
				options={[
					{
						value: 'fixed',
						label: t('screens.rates.basis-fixed-option'),
						note: t('screens.rates.basis-fixed-note'),
					},
					{
						value: 'source',
						label: t('screens.rates.basis-source-option'),
						note: t('screens.rates.basis-source-note'),
					},
				]}
				chosen={[draft.basis]}
				onChoose={basis => set({ basis })}
			/>
			{draft.basis === 'source' ? (
				<>
					{/* Step 8 and path C: the party chooses the source and the margin. */}
					<Text style={styles.caption}>{t('screens.rates.source-yours')}</Text>
					<Input
						label={t('screens.rates.margin-field')}
						value={draft.margin}
						onChangeText={margin => set({ margin })}
						keyboardType="numeric"
					/>
				</>
			) : null}

			<Input
				label={t('screens.rates.accept-field', { unit: label })}
				value={draft.accept}
				onChangeText={accept => set({ accept })}
				keyboardType="numeric"
			/>
			<Input
				label={t('screens.rates.part-field', { unit: label })}
				value={draft.part}
				onChangeText={part => set({ part })}
				keyboardType="numeric"
				note={t('screens.rates.direction-note')}
			/>

			<Text style={styles.heading}>{t('screens.rates.movement-question')}</Text>
			<Options<'yes' | 'no'>
				options={[
					{ value: 'no', label: t('screens.rates.movement-no') },
					{ value: 'yes', label: t('screens.rates.movement-yes') },
				]}
				chosen={[draft.permitsMovement ? 'yes' : 'no']}
				onChoose={answer => set({ permitsMovement: answer === 'yes' })}
			/>

			<Text style={styles.caption}>{t('screens.rates.enables-figures')}</Text>
			{draft.permitsMovement ? (
				<Text style={styles.caption}>{t('screens.rates.enables-movement', { unit: label })}</Text>
			) : null}
			<Text style={styles.caption}>{t('screens.rates.scope', { unit: label })}</Text>

			{failure ? (
				<Text style={styles.warning}>
					{failure.kind === 'inverted' ? t('screens.rates.inverted') : failure.message}
				</Text>
			) : null}

			<View style={styles.actions}>
				<Action label={t('screens.rates.cancel')} onPress={onCancel} secondary />
				{/* Step 9: signed, like anything governing movement that happens
				    without the party being asked again. */}
				<Action label={t('screens.rates.sign')} onPress={draft.accept ? onSign : undefined} />
			</View>
		</Card>
	)
}

/** Step 10: what converted, which way, at what rate, and where it came from. */
function Converted({ page }: { page: RatesPage }): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<Card title={t('screens.rates.converted')}>
			{page.conversions.length === 0 ? (
				<Text style={styles.caption}>{t('screens.rates.converted-none')}</Text>
			) : (
				page.conversions.map(conversion => (
					<ConversionRow key={conversion.id} conversion={conversion} against={page.against} />
				))
			)}
		</Card>
	)
}

function ConversionRow({
	conversion,
	against,
}: {
	conversion: Conversion
	against: string
}): React.JSX.Element {
	const styles = useStyles(make)
	const from = conversion.fromAmount
	const to = conversion.toAmount
	return (
		<View style={styles.block}>
			<View style={styles.conversion}>
				<Amount value={from} unit={from} size="small" />
				<Text style={styles.meta}>{I18nManager.isRTL ? '←' : '→'}</Text>
				<Amount value={to} unit={to} size="small" />
			</View>
			<Text style={styles.meta}>
				{formatInstant(conversion.at)}
				{' · '}
				{t('screens.rates.converted-at', {
					rate: formatRate(conversion.rate, against),
					basis:
						conversion.basis === 'source'
							? t('screens.rates.converted-source', { source: conversion.sourceName ?? '' })
							: t('screens.rates.converted-fixed'),
				})}
			</Text>
		</View>
	)
}

/**
 * A rate is not an amount — it is a ratio between two units — so it is written
 * plainly rather than through `Amount`, which would give it a unit it does not
 * have.
 */
function formatRate(rate: number, against: string): string {
	const divisor = divisorOf({ denom: against, scale: 2 })
	return `${(rate / divisor).toFixed(String(divisor - 1).length)}`
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	block: { gap: spacing[0], paddingVertical: spacing[0] },
	warningBlock: { gap: spacing[0], paddingVertical: spacing[1] },
	conversion: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing[1] },
	actions: {
		flexDirection: 'row' as const,
		justifyContent: 'flex-end' as const,
		gap: spacing[2],
		marginTop: spacing[1],
	},
	heading: { ...typography.small, color: tokens.textSecondary, marginTop: spacing[1] },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	warning: { ...typography.caption, color: tokens.negative },
	meta: { ...typography.small, color: tokens.textSecondary },
})
