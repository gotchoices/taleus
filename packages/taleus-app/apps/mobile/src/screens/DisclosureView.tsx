import { useCallback, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Card, Failed, Input, Loading, Options } from '../components'
import {
	answerRequest,
	askFor,
	discloseMore,
	readProfile,
	type Disclosure,
	type Field,
	type InfoRequest,
} from '../data/profile'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'
import { fieldInline, fieldLabel, fieldList, knownFields } from '../util/fields'

type Props = ScreenProps<'DisclosureView'>

/**
 * DisclosureView (story 11) — what passed between this party and one
 * counterparty, in both directions.
 *
 * Three of the story's rules shape it. What the counterparty sent is *their
 * claim*, presented as such, because Taleus verified none of it (path E step 2).
 * What is missing is presented as missing and nothing more: from this side a
 * withheld address and one that was never recorded are indistinguishable, and
 * the screen does not pretend otherwise (path E step 3). And a refusal — theirs
 * or this party's — is an answer, not a failure; it is recorded plainly and
 * carries no reproach either way.
 */
export function DisclosureView({ route }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { tallyId } = route.params
	const { state, value, error, reload } = useLoad(useCallback(() => readProfile(), []))
	const [picked, setPicked] = useState<string[]>([])
	const [asking, setAsking] = useState<{ keys: string[]; why: string } | undefined>()
	const [told, setTold] = useState(false)
	const [notHeld, setNotHeld] = useState<string | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	const disclosure = value?.disclosures.find(item => item.tallyId === tallyId)
	if (state === 'failed' || !value || !disclosure) {
		return (
			<Failed
				title={t('screens.disclosure.unreadable-title')}
				error={error ?? { kind: 'not-found', message: tallyId, retryable: false }}
				onRetry={reload}
			/>
		)
	}

	const name = disclosure.counterparty.name
	const sentKeys = new Set(disclosure.sent.map(field => field.key))
	const untold = value.held.filter(field => !sentKeys.has(field.key))
	const receivedKeys = new Set(disclosure.received.map(field => field.key))
	const asked = new Set(disclosure.requests.filter(item => item.from === 'me').map(item => item.key))
	const absent = knownFields.filter(key => !receivedKeys.has(key) && !asked.has(key))

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card title={t('screens.disclosure.i-told', { name })}>
				{disclosure.sent.length === 0 ? (
					<Text style={styles.caption}>{t('screens.disclosure.i-told-none')}</Text>
				) : (
					disclosure.sent.map((field, index) => (
						<SentField
							key={`${field.key}-${index}`}
							field={field}
							superseded={disclosure.sent.some(
								other => other.key === field.key && (other.at ?? '') > (field.at ?? ''),
							)}
							supersededAt={
								disclosure.sent
									.filter(other => other.key === field.key && (other.at ?? '') > (field.at ?? ''))
									.map(other => other.at)
									.shift()
							}
						/>
					))
				)}
			</Card>

			{/* Step 7: more disclosed on the tally that already exists. No new tally,
			    no renegotiated terms — and they are told, because this is not
			    something to file silently into a record they may never reread. */}
			{untold.length > 0 ? (
				<Card
					title={t('screens.disclosure.tell-more')}
					footnote={t('screens.disclosure.tell-more-note')}
				>
					<Options
						multiple
						options={untold.map(field => ({
							value: field.key,
							label: fieldLabel(field.key),
							note: field.value,
						}))}
						chosen={picked}
						// Functional updates throughout: a tick and a keystroke can land in
						// one batch, and an update built from a render-time copy would then
						// undo the other one.
						onChoose={key => setPicked(toggle(key))}
					/>
					<Action
						label={t('screens.disclosure.tell-more-send')}
						onPress={
							picked.length > 0
								? () =>
										void discloseMore(tallyId, picked).then(() => {
											setPicked([])
											setTold(true)
											reload()
										})
								: undefined
						}
					/>
					{told ? (
						<Text style={styles.caption}>{t('screens.disclosure.tell-more-sent', { name })}</Text>
					) : null}
				</Card>
			) : null}

			<Card
				title={t('screens.disclosure.they-say', { name })}
				footnote={t('screens.disclosure.they-say-note')}
			>
				{disclosure.received.length === 0 ? (
					<Text style={styles.caption}>{t('screens.disclosure.they-say-none')}</Text>
				) : (
					disclosure.received.map(field => (
						<View key={field.key} style={styles.field}>
							<Text style={styles.meta}>{fieldLabel(field.key)}</Text>
							<Text style={styles.body}>{field.value}</Text>
						</View>
					))
				)}
			</Card>

			{/* Path E step 3, and the answer to it in step 4: absence says nothing, so
			    the only way past it is to ask. */}
			{absent.length > 0 ? (
				<Card title={t('screens.disclosure.missing')}>
					<Text style={styles.caption}>
						{t('screens.disclosure.missing-body', { fields: fieldList(absent) })}
					</Text>
					{asking ? (
						<>
							<Options
								multiple
								options={absent.map(key => ({ value: key, label: fieldLabel(key) }))}
								chosen={asking.keys}
								onChoose={key =>
									setAsking(current =>
										current ? { ...current, keys: toggle(key)(current.keys) } : current,
									)
								}
							/>
							<Input
								label={t('screens.disclosure.ask-why')}
								placeholder={t('screens.disclosure.ask-why-placeholder')}
								value={asking.why}
								onChangeText={why =>
									setAsking(current => (current ? { ...current, why } : current))
								}
								multiline
							/>
							<Action
								label={t('screens.disclosure.ask-send')}
								onPress={
									asking.keys.length > 0
										? () =>
												void askFor(tallyId, asking.keys, asking.why.trim()).then(() => {
													setAsking(undefined)
													reload()
												})
										: undefined
								}
							/>
						</>
					) : (
						<>
							<Text style={styles.caption}>{t('screens.disclosure.ask-note')}</Text>
							<Action
								label={t('screens.disclosure.ask')}
								onPress={() => setAsking({ keys: [], why: '' })}
								secondary
							/>
						</>
					)}
				</Card>
			) : null}

			{disclosure.requests.map(request => (
				<RequestCard
					key={request.id}
					request={request}
					disclosure={disclosure}
					held={value.held}
					notHeld={notHeld === request.id}
					onAnswer={async kind => {
						const result = await answerRequest(request.id, { kind })
						setNotHeld(result.ok ? undefined : request.id)
						reload()
					}}
				/>
			))}
		</ScrollView>
	)
}

/** Add or remove one value, without reading the list at render time. */
function toggle(value: string): (current: string[]) => string[] {
	return current =>
		current.includes(value) ? current.filter(item => item !== value) : [...current, value]
}

/**
 * A correction does not erase what it replaced: both statements stay visible to
 * both sides (path D step 4), so a superseded value is marked rather than gone.
 */
function SentField({
	field,
	superseded,
	supersededAt,
}: {
	field: Field
	superseded: boolean
	supersededAt?: string
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.field}>
			<Text style={styles.meta}>{fieldLabel(field.key)}</Text>
			<Text style={superseded ? styles.supersededValue : styles.body}>{field.value}</Text>
			<Text style={styles.meta}>
				{superseded && supersededAt
					? t('screens.disclosure.superseded', { date: formatInstant(supersededAt) })
					: field.pending
						? t('screens.disclosure.sent-pending')
						: t('screens.disclosure.sent-at', { date: formatInstant(field.at ?? '') })}
			</Text>
		</View>
	)
}

/**
 * One ask, either direction. Path B: asking turns an ambiguous silence into a
 * plain yes or no, and the party is free to give either — so "I would rather
 * not" sits beside "send it" as an equal answer, and the note says what the
 * counterparty will see rather than warning the party off.
 */
function RequestCard({
	request,
	disclosure,
	held,
	notHeld,
	onAnswer,
}: {
	request: InfoRequest
	disclosure: Disclosure
	held: Field[]
	notHeld: boolean
	onAnswer(kind: 'supplied' | 'refused'): Promise<void>
}): React.JSX.Element {
	const styles = useStyles(make)
	const name = disclosure.counterparty.name
	const field = fieldInline(request.key)

	if (request.from === 'me') {
		return (
			<Card title={t('screens.disclosure.i-asked', { field })}>
				<Text style={styles.caption}>
					{!request.answer
						? t('screens.disclosure.i-asked-waiting', { date: formatInstant(request.asked) })
						: request.answer.kind === 'supplied'
							? t('screens.disclosure.i-asked-supplied', {
									date: formatInstant(request.answer.at),
								})
							: t('screens.disclosure.i-asked-refused', { date: formatInstant(request.answer.at) })}
				</Text>
			</Card>
		)
	}

	if (request.answer) {
		return (
			<Card title={t('screens.disclosure.they-asked', { name, field })}>
				<Text style={styles.caption}>
					{request.answer.kind === 'supplied'
						? t('screens.disclosure.answered-supplied', { date: formatInstant(request.answer.at) })
						: t('screens.disclosure.answered-refused', { date: formatInstant(request.answer.at) })}
				</Text>
			</Card>
		)
	}

	const have = held.some(item => item.key === request.key)
	return (
		<Card title={t('screens.disclosure.they-asked', { name, field })}>
			{request.why ? (
				<Text style={styles.caption}>{t('screens.disclosure.they-asked-why', { why: request.why })}</Text>
			) : null}
			<View style={styles.actions}>
				<Action label={t('screens.disclosure.refuse')} onPress={() => void onAnswer('refused')} secondary />
				<Action
					label={t('screens.disclosure.supply')}
					onPress={have ? () => void onAnswer('supplied') : undefined}
				/>
			</View>
			{/* Path A: the party is not willing, and that has to be a first-class
			    answer. Nothing here calls it a failure or leans on them to give in. */}
			<Text style={styles.caption}>{t('screens.disclosure.refuse-note')}</Text>
			{!have || notHeld ? (
				<Text style={styles.caption}>{t('screens.disclosure.not-held', { field })}</Text>
			) : null}
		</Card>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	field: { gap: spacing[0], paddingVertical: spacing[0] },
	actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: spacing[2] },
	body: { ...typography.body, color: tokens.textPrimary },
	supersededValue: {
		...typography.body,
		color: tokens.textSecondary,
		textDecorationLine: 'line-through' as const,
	},
	meta: { ...typography.small, color: tokens.textSecondary },
	caption: { ...typography.caption, color: tokens.textSecondary },
})
