/**
 * Tallies, one tally in detail, and the contract offer that opens one.
 */
import type { CreditTerms, PaymentRequest as CorePaymentRequest, Tally, TallyView } from 'taleus-core'

import { agreementDocumentOf, agreementOf, agreementToDecide } from '../contracts/index.js'
import type { Offer, OffersModel } from '../offers.js'
import type { TalliesModel } from '../tallies.js'
import type { Terms, TallyDetail, TallyModel, TermsRecord } from '../tally.js'
import type { TallySummary, Unit, WaitingOn } from '../types.js'
import type { MadeInvitation, Session } from './session.js'
import {
	amount,
	balanceOf,
	failed,
	fromCore,
	instantOf,
	nameOf,
	ok,
	refused,
	stateOf,
	unsupported,
} from './translate.js'

/** Whose move it is on a tally, and why -- the one rule the list, the detail and attention share. */
export interface Situation {
	waitingOn: WaitingOn
	waitingReason?: 'offer' | 'request' | 'closing'
}

export function situationOf(view: TallyView, requests: CorePaymentRequest[]): Situation {
	switch (view.state) {
		case 'forming':
			// The invitee has not joined, or the agents are still publishing terms. Either way
			// nothing here needs this party.
			return { waitingOn: 'them' }
		case 'offered':
			return { waitingOn: view.offer?.by === 'me' ? 'them' : 'me', waitingReason: 'offer' }
		case 'open': {
			const open = requests.filter(r => r.state === 'open' || r.state === 'expired')
			if (open.some(r => r.from === 'counterparty')) return { waitingOn: 'me', waitingReason: 'request' }
			if (open.some(r => r.from === 'me')) return { waitingOn: 'them', waitingReason: 'request' }
			return { waitingOn: 'nobody' }
		}
		case 'closing': {
			// Closing ends at a settled zero, so it waits on whoever owes.
			const settled = view.balances.settled.units
			if (settled < 0) return { waitingOn: 'me', waitingReason: 'closing' }
			if (settled > 0) return { waitingOn: 'them', waitingReason: 'closing' }
			return { waitingOn: 'nobody' }
		}
		default:
			return { waitingOn: 'nobody' }
	}
}

function termsOf(terms: CreditTerms | undefined, unit: Unit, today: string): Terms {
	if (!terms) return { creditLimit: amount(0, unit), noticeDays: 0, effective: today }
	return {
		creditLimit: fromCore(terms.limit, unit),
		noticeDays: terms.callDays,
		effective: terms.effectiveFrom,
		...(terms.pending
			? {
					pending: {
						creditLimit: fromCore(terms.pending.limit, unit),
						noticeDays: terms.pending.callDays,
						effective: terms.pending.effectiveFrom,
					},
				}
			: {}),
	}
}

/** When the tally last moved: its latest entry, else its creation, else when this party invited. */
async function lastActivity(tally: Tally, view: TallyView, invited?: MadeInvitation): Promise<string> {
	const latest = (await tally.history({ limit: 1 }))[0]
	const at = latest?.at ?? view.createdAt
	return at || !invited ? instantOf(at) : invited.created
}

export async function summaryOf(session: Session, tally: Tally, view: TallyView): Promise<TallySummary> {
	const unit = session.unitOf(view)
	const invited = session.local.madeInvitations.find(made => made.tallyId === view.ref.id)
	const untaken = invited && !view.counterparty.sid ? invited : undefined
	return {
		id: view.ref.id,
		counterparty: { sid: view.counterparty.sid, name: nameOf(view.counterparty.sid, view.counterparty.certificate) },
		unit,
		balance: balanceOf(view.balances.settled.units, unit),
		state: stateOf(view.state),
		...situationOf(view, await tally.requests()),
		lastActivity: await lastActivity(tally, view, invited),
		...(untaken ? { invitation: untaken.note ? { note: untaken.note } : {} } : {}),
	}
}

export function talliesModel(session: Session): TalliesModel {
	return {
		async listTallies() {
			const out: TallySummary[] = []
			for (const { tally, view } of await session.views()) out.push(await summaryOf(session, tally, view))
			return ok(out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)))
		},
	}
}

export function tallyModel(session: Session): TallyModel {
	async function detail(tallyId: string) {
		const tally = await session.tally(tallyId)
		if (!tally) return failed<TallyDetail>('not-found', `no tally ${tallyId}`)
		const view = await tally.read()
		const unit = session.unitOf(view)
		const summary = await summaryOf(session, tally, view)
		const today = session.today()
		const value: TallyDetail = {
			id: view.ref.id,
			counterparty: summary.counterparty,
			unit,
			balance: summary.balance,
			state: summary.state,
			waitingOn: summary.waitingOn,
			opened: instantOf(view.createdAt),
			agreement: await agreementOf(session.agreements, view.contract?.cid ?? view.offer?.contractCid ?? '', tally),
			terms: { mine: termsOf(view.terms.mine, unit, today), theirs: termsOf(view.terms.theirs, unit, today) },
			roomToSpend: fromCore(view.balances.capacity.canSend, unit),
			// In memory, the counterparty is always here. Over a network this becomes a real
			// question, answered by the store.
			counterpartyReachable: true,
			...(view.closeRequestedBy
				? { closing: { requestedBy: view.closeRequestedBy, requested: instantOf(today) } }
				: {}),
		}
		return ok(value)
	}

	return {
		readTally: detail,

		async readTerms(tallyId) {
			const tally = await session.tally(tallyId)
			if (!tally) return failed<TermsRecord>('not-found', `no tally ${tallyId}`)
			const view = await tally.read()
			const unit = session.unitOf(view)
			// The core reports the terms in force (and any pending revision), not their whole
			// history -- each side's current revision is the record for now.
			const history = (['mine', 'theirs'] as const).flatMap(side => {
				const terms = view.terms[side]
				if (!terms) return []
				return [{
					id: `${tallyId}:${side}:${terms.revision}`,
					side,
					by: side === 'mine' ? ('me' as const) : ('them' as const),
					creditLimit: fromCore(terms.limit, unit),
					noticeDays: terms.callDays,
					agreed: terms.effectiveFrom,
					effective: terms.effectiveFrom,
					governs: 'everything' as const,
					...(terms.revision === 1 ? { opening: true } : {}),
				}]
			})
			return ok({ history })
		},

		async readAgreement(agreementId, tallyId) {
			const tally = tallyId ? await session.tally(tallyId) : undefined
			const document = await agreementDocumentOf(session.agreements, agreementId, tally)
			return document ? ok(document) : failed('not-found', `the agreement ${agreementId} cannot be read in full`)
		},

		async requestClose(tallyId) {
			const tally = await session.tally(tallyId)
			if (!tally) return failed<TallyDetail>('not-found', `no tally ${tallyId}`)
			const result = await tally.requestClose()
			if (!result.ok) return refused(result.refusal)
			return detail(tallyId)
		},

	}
}

export function offersModel(session: Session): OffersModel {
	return {
		async readOffer(tallyId) {
			const tally = await session.tally(tallyId)
			if (!tally) return failed<Offer | null>('not-found', `no tally ${tallyId}`)
			const view = await tally.read()
			if (!view.offer) return ok(null)
			const unit = session.unitOf(view)
			const offer: Offer = {
				id: `${tallyId}:offer`,
				tallyId,
				counterparty: { sid: view.counterparty.sid, name: nameOf(view.counterparty.sid, view.counterparty.certificate) },
				waitingOn: view.offer.by === 'me' ? 'them' : 'me',
				drafted: instantOf(session.today()),
				unit,
				agreement: await agreementToDecide(session.agreements, view.offer.contractCid, tally),
				proposed: {
					mine: { creditLimit: fromCore(view.terms.mine?.limit ?? { units: 0, denomination: unit.denom }, unit), noticeDays: view.terms.mine?.callDays ?? 0 },
					theirs: { creditLimit: fromCore(view.terms.theirs?.limit ?? { units: 0, denomination: unit.denom }, unit), noticeDays: view.terms.theirs?.callDays ?? 0 },
				},
				inForce: null,
				changes: [],
			}
			return ok(offer)
		},

		async respondToOffer(tallyId, answer) {
			if (answer === 'counter') return unsupported('Countering an offer', 'feat-offer-lifecycle')
			const tally = await session.tally(tallyId)
			if (!tally) return failed('not-found', `no tally ${tallyId}`)
			const offered = (await tally.read()).offer?.contractCid
			// Story 02 path E: nobody should be bound by text they cannot read.
			if (offered && (await session.library.gather(offered, tally)).missing.length > 0) {
				return failed('agreement-unreadable', 'the agreement this offer names cannot be read in full')
			}
			const accepted = await tally.acceptContract()
			if (!accepted.ok) return refused(accepted.refusal)
			return ok('accepted' as const)
		},
	}
}
