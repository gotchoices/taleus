import { useCallback, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Card, Failed, Input, Loading, OpenableRow, Options } from '../components'
import {
	authorizeCorrection,
	setField,
	staleHolders,
	type Delivery,
	type Disclosure,
} from '../data/profile'
import { readProfile } from '../data/profile'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { fieldInline, fieldLabel, fieldList, knownFields } from '../util/fields'

type Props = ScreenProps<'Profile'>

/** A correction waiting to be authorized, and what became of it. */
interface Correction {
	key: string
	holders: Disclosure[]
	picked: string[]
	deliveries?: Delivery[]
	declined?: boolean
}

/**
 * Profile (story 11) — what this party holds about itself, and what it has told
 * whom.
 *
 * The screen's two lists are the story's first two steps, and they are separate
 * because step 2 is a promise: adding something to your own record does not send
 * it to anybody. A screen that showed one list would break that promise no
 * matter what the adapter did.
 *
 * Changing a value others already hold is the other thing this screen owns
 * (path D). A correction is a statement the party signs, per counterparty, so
 * the app asks who gets it and sends nothing on its own — and reports per
 * counterparty, because only some of a set will reach.
 */
export function Profile({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => readProfile(), []))
	const [editing, setEditing] = useState<{ key: string; draft: string } | undefined>()
	const [correction, setCorrection] = useState<Correction | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.profile.unreadable-title')} error={error} onRetry={reload} />
	}

	const held = value.held
	const missing = knownFields.filter(key => !held.some(field => field.key === key))

	const save = async () => {
		if (!editing) {
			return
		}
		const { key, draft } = editing
		setEditing(undefined)
		const result = await setField(key, draft.trim())
		if (!result.ok) {
			return
		}
		reload()
		// Nothing has been sent by saving. What follows is the *offer* to correct
		// the counterparties who hold the old value — declining it sends nothing.
		const holders = staleHolders(result.value, key)
		if (holders.length > 0) {
			setCorrection({ key, holders, picked: holders.map(holder => holder.tallyId) })
		}
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card title={t('screens.profile.held')} footnote={t('screens.profile.held-note')}>
				{held.map(field =>
					editing?.key === field.key ? (
						<Editor
							key={field.key}
							field={field.key}
							draft={editing.draft}
							onChange={draft => setEditing({ key: field.key, draft })}
							onSave={() => void save()}
							onCancel={() => setEditing(undefined)}
						/>
					) : (
						<OpenableRow
							key={field.key}
							onPress={() => setEditing({ key: field.key, draft: field.value })}
							accessibilityLabel={`${fieldLabel(field.key)}: ${field.value}`}
						>
							<Text style={styles.meta}>{fieldLabel(field.key)}</Text>
							<Text style={styles.body}>{field.value}</Text>
						</OpenableRow>
					),
				)}
			</Card>

			{correction ? (
				<CorrectionCard
					correction={correction}
					// Functional update: the tick and whatever else is in flight must not
					// each build their next state from the same render-time copy.
					onPick={tallyId =>
						setCorrection(current =>
							current
								? {
										...current,
										picked: current.picked.includes(tallyId)
											? current.picked.filter(id => id !== tallyId)
											: [...current.picked, tallyId],
									}
								: current,
						)
					}
					onSend={async () => {
						const result = await authorizeCorrection(correction.key, correction.picked)
						setCorrection(current =>
							current ? { ...current, deliveries: result.ok ? result.value : [] } : current,
						)
						reload()
					}}
					onDecline={() =>
						setCorrection(current => (current ? { ...current, declined: true, picked: [] } : current))
					}
				/>
			) : null}

			{missing.length > 0 ? (
				<Card title={t('screens.profile.add')} footnote={t('screens.profile.add-note')}>
					{missing.map(key =>
						editing?.key === key ? (
							<Editor
								key={key}
								field={key}
								draft={editing.draft}
								onChange={draft => setEditing({ key, draft })}
								onSave={() => void save()}
								onCancel={() => setEditing(undefined)}
							/>
						) : (
							<OpenableRow
								key={key}
								onPress={() => setEditing({ key, draft: '' })}
								accessibilityLabel={fieldLabel(key)}
							>
								<Text style={styles.body}>{fieldLabel(key)}</Text>
							</OpenableRow>
						),
					)}
				</Card>
			) : null}

			<Card title={t('screens.profile.disclosures')}>
				{value.disclosures.length === 0 ? (
					<Text style={styles.caption}>{t('screens.profile.disclosures-none')}</Text>
				) : (
					value.disclosures.map(disclosure => (
						<OpenableRow
							key={disclosure.tallyId}
							onPress={() => navigation.navigate('DisclosureView', { tallyId: disclosure.tallyId })}
							accessibilityLabel={disclosure.counterparty.name}
						>
							<Text style={styles.body}>{disclosure.counterparty.name}</Text>
							<Text style={styles.meta}>{summarise(disclosure)}</Text>
						</OpenableRow>
					))
				)}
			</Card>
		</ScrollView>
	)
}

/** What they hold, in one line — the answer to "who has my phone number?". */
function summarise(disclosure: Disclosure): string {
	const keys = [...new Set(disclosure.sent.map(field => field.key))]
	const pending = disclosure.sent.every(field => field.pending)
	const summary = t('screens.profile.sent-summary', { fields: fieldList(keys) })
	return pending ? `${summary} — ${t('screens.profile.sent-pending')}` : summary
}

function Editor({
	field,
	draft,
	onChange,
	onSave,
	onCancel,
}: {
	field: string
	draft: string
	onChange(value: string): void
	onSave(): void
	onCancel(): void
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.editor}>
			<Input
				label={fieldLabel(field)}
				value={draft}
				onChangeText={onChange}
				autoFocus
				autoCorrect={false}
				returnKeyType="done"
				onSubmitEditing={onSave}
			/>
			<View style={styles.actions}>
				<Action label={t('screens.profile.cancel')} onPress={onCancel} secondary />
				<Action label={t('screens.profile.save')} onPress={draft.trim() ? onSave : undefined} />
			</View>
		</View>
	)
}

/**
 * Path D. The set is offered, never assumed: the party authorizes once, for the
 * partners they choose, and a correction that could not be delivered says so
 * rather than being counted as sent.
 */
function CorrectionCard({
	correction,
	onPick,
	onSend,
	onDecline,
}: {
	correction: Correction
	onPick(tallyId: string): void
	onSend(): Promise<void>
	onDecline(): void
}): React.JSX.Element {
	const styles = useStyles(make)
	const field = fieldInline(correction.key)

	if (correction.declined) {
		return (
			<Card title={t('screens.profile.correction-title')}>
				<Text style={styles.caption}>{t('screens.profile.correction-none')}</Text>
			</Card>
		)
	}

	if (correction.deliveries) {
		const sent = correction.deliveries.filter(delivery => delivery.delivered)
		const failed = correction.deliveries.filter(delivery => !delivery.delivered)
		return (
			<Card title={t('screens.profile.correction-title')}>
				{sent.length > 0 ? (
					<Text style={styles.caption}>
						{t('screens.profile.correction-sent', {
							count: sent.length,
							names: sent.map(delivery => delivery.name).join(', '),
						})}
					</Text>
				) : null}
				{failed.length > 0 ? (
					<Text style={styles.warning}>
						{t('screens.profile.correction-failed', {
							names: failed.map(delivery => delivery.name).join(', '),
						})}
					</Text>
				) : null}
				{correction.deliveries.length === 0 ? (
					<Text style={styles.caption}>{t('screens.profile.correction-none')}</Text>
				) : null}
			</Card>
		)
	}

	return (
		<Card title={t('screens.profile.correction-title')}>
			<Text style={styles.caption}>
				{t('screens.profile.correction-body', { count: correction.holders.length, field })}
			</Text>
			<Options
				multiple
				options={correction.holders.map(holder => ({
					value: holder.tallyId,
					label: holder.counterparty.name,
					note: holder.sent
						.filter(sent => sent.key === correction.key)
						.map(sent => sent.value)
						.pop(),
				}))}
				chosen={correction.picked}
				onChoose={onPick}
			/>
			<View style={styles.actions}>
				<Action label={t('screens.profile.correction-later')} onPress={onDecline} secondary />
				<Action
					label={t('screens.profile.correction-send')}
					onPress={correction.picked.length > 0 ? () => void onSend() : undefined}
				/>
			</View>
		</Card>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	editor: { gap: spacing[2], paddingVertical: spacing[1] },
	actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: spacing[2] },
	body: { ...typography.body, color: tokens.textPrimary },
	meta: { ...typography.small, color: tokens.textSecondary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	warning: { ...typography.caption, color: tokens.negative },
})
