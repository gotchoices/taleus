/**
 * The party, and the invitations that make tallies: who this party is, and how a tally begins.
 */
import type { InvitationsModel, Invitation, OpenInvitation, Agreement } from '../invitations.js'
import type { Party, PartyModel } from '../party.js'
import type { Result } from '../types.js'
import { decodeEnvelope, encodeEnvelope } from './envelope.js'
import type { Session } from './session.js'
import { failed, ok, refused, unsupported } from './translate.js'

const DAY = 86_400_000

export function partyModel(session: Session): PartyModel {
	const party = (): Party | null =>
		session.identity
			? {
					sid: session.identity.sid,
					displayName: session.local.displayName,
					displayUnit: '',
					disclosed: session.local.disclosed,
					devices: [],
				}
			: null
	return {
		async readParty() {
			return ok(party())
		},
		async createIdentity() {
			if (!session.identity) await session.createIdentity()
			return ok(party() as Party)
		},
		async setDisplayName(name) {
			session.local.displayName = name
			session.changed()
			// The name is what a counterparty sees, so every tally hears about it.
			for (const { tally } of await session.views()) {
				await tally.publishCertificate(session.certificate())
			}
			return ok(party() as Party)
		},
	}
}

export function invitationsModel(session: Session): InvitationsModel {
	const agreements = (): Agreement[] =>
		(session.options.agreements ?? []).map(({ id, title, publisher, language }) => ({ id, title, publisher, language }))

	const agreementFor = (id: string): Agreement =>
		agreements().find(a => a.id === id) ?? { id, title: id, publisher: '', language: '' }

	async function stateOf(made: { tallyId: string; envelope: { expires: string }; withdrawn?: boolean }): Promise<Invitation['state']> {
		if (made.withdrawn) return 'withdrawn'
		const tally = await session.tally(made.tallyId)
		if (tally && (await tally.read()).counterparty.sid !== '') return 'taken-up'
		return Date.parse(made.envelope.expires) < session.now().getTime() ? 'expired' : 'outstanding'
	}

	return {
		async listInvitations(): Promise<Result<Invitation[]>> {
			const out: Invitation[] = []
			for (const made of session.local.madeInvitations) {
				out.push({
					token: made.token,
					...(made.note ? { note: made.note } : {}),
					state: await stateOf(made),
					unit: made.envelope.unit,
					creditLimit: made.envelope.creditLimit,
					noticeDays: made.envelope.noticeDays,
					agreementId: made.envelope.agreementId,
					created: made.created,
					expires: made.envelope.expires,
				})
			}
			return ok(out)
		},

		async listAgreements() {
			return ok(agreements())
		},

		async createInvitation(draft) {
			const engine = session.engine
			if (!engine || !session.identity) return failed('no-identity', 'create an identity before inviting anyone')
			const invited = await engine.invite({ as: 'stock', denomination: draft.unit.denom, certificate: session.certificate() })
			if (!invited.ok) return refused(invited.refusal)
			const created = session.now()
			const envelope = {
				v: 1 as const,
				ticket: {
					ref: invited.value.ticket.ref.id,
					...(invited.value.ticket.ref.address ? { address: invited.value.ticket.ref.address } : {}),
					encoded: invited.value.ticket.encoded,
				},
				inviter: { sid: session.identity.sid, disclosed: session.certificate() },
				unit: draft.unit,
				creditLimit: draft.creditLimit,
				noticeDays: draft.noticeDays,
				agreementId: draft.agreementId,
				expires: new Date(created.getTime() + draft.goodForDays * DAY).toISOString(),
				...(draft.note ? { note: draft.note } : {}),
			}
			const tallyId = invited.value.ref.id
			const token = encodeEnvelope(envelope)
			session.local.madeInvitations.push({ token, tallyId, envelope, created: created.toISOString(), ...(draft.note ? { note: draft.note } : {}) })
			session.local.intended[tallyId] = {
				creditLimit: draft.creditLimit,
				noticeDays: draft.noticeDays,
				propose: { agreementId: draft.agreementId },
			}
			session.local.units[tallyId] = draft.unit
			session.changed()
			const listed = (await this.listInvitations()) as { ok: true; value: Invitation[] }
			return ok(listed.value.find(i => i.token === token) as Invitation)
		},

		async readInvitation(token): Promise<Result<OpenInvitation>> {
			const envelope = decodeEnvelope(token)
			if (!envelope) return failed('not-found', 'that is not a Taleus invitation')
			const answered = session.local.answeredInvitations[token]
			const expired = Date.parse(envelope.expires) < session.now().getTime()
			return ok({
				token,
				state: answered === 'accepted' ? 'taken-up' : expired ? 'expired' : 'outstanding',
				inviter: { sid: envelope.inviter.sid, disclosed: envelope.inviter.disclosed },
				unit: envelope.unit,
				theirCreditLimit: envelope.creditLimit,
				theirNoticeDays: envelope.noticeDays,
				agreement: agreementFor(envelope.agreementId),
				expires: envelope.expires,
				asks: [],
			})
		},

		async respondToInvitation(token, answer, response) {
			const envelope = decodeEnvelope(token)
			if (!envelope) return failed('not-found', 'that is not a Taleus invitation')
			if (answer === 'refuse') {
				// Refusing an invitation sends nothing: the invitee never joined, so there is no
				// tally to record it on, and the inviter sees it lapse.
				session.local.answeredInvitations[token] = 'refused'
				session.changed()
				return ok('refused' as const)
			}
			const engine = session.engine
			if (!engine) return failed('no-identity', 'create an identity before accepting an invitation')
			if (!response) return failed('terms', 'accepting needs the credit you will extend in return')
			Object.assign(session.local.disclosed, response.disclose)
			const accepted = await engine.accept(
				{
					ref: { id: envelope.ticket.ref, ...(envelope.ticket.address ? { address: envelope.ticket.address } : {}) },
					encoded: envelope.ticket.encoded,
				},
				{ certificate: session.certificate() },
			)
			if (!accepted.ok) return refused(accepted.refusal)
			const tallyId = accepted.value.ref.id
			session.remember(tallyId, accepted.value)
			session.local.intended[tallyId] = { creditLimit: response.creditLimit, noticeDays: response.noticeDays }
			session.local.units[tallyId] = envelope.unit
			session.local.answeredInvitations[token] = 'accepted'
			session.changed()
			await session.advance()
			return ok('accepted' as const)
		},

		answerTo(token) {
			return session.local.answeredInvitations[token]
		},
	}
}

/** Standing invitations need one invitation many can take up, which Sereus does not offer yet. */
export const standingUnsupported = <T>(): Result<T> =>
	unsupported('A standing invitation', 'feat-standing-invitation, feat-multi-use-tally-invitation')
