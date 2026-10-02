/**
 * What moved on a tally, and what was asked for: entries and payment requests.
 */
import type { Entry as CoreEntry, PaymentRequest as CorePaymentRequest, Tally, TallyView } from 'taleus-core'

import type { EntriesModel, Entry, Preview } from '../entries.js'
import type { PaymentRequest, RequestsModel } from '../requests.js'
import { daysSince, type Unit } from '../types.js'
import type { Session } from './session.js'
import {
	amount,
	balanceOf,
	failed,
	instantOf,
	nameOf,
	ok,
	refused,
	requestStateOf,
	toCore,
	unsupported,
} from './translate.js'

function entryOf(entry: CoreEntry, unit: Unit): Entry {
	return {
		id: entry.id,
		kind: entry.origin === 'lift' ? 'routed' : 'direct',
		// A chit is signed by the party it makes worse off: value going out was this party's act.
		issuer: entry.origin === 'lift' ? 'network' : entry.direction === 'out' ? 'me' : 'them',
		// Signed from the reader's side, as the model's `Entry` states: value toward this party is
		// positive, value away is negative. The core gives the size and the direction separately.
		amount: amount(entry.direction === 'in' ? entry.amount.units : -entry.amount.units, unit),
		date: instantOf(entry.at),
		...(entry.memo ? { memo: entry.memo } : {}),
		balanceAfter: balanceOf(entry.balanceAfter.units, unit),
		...(entry.requestId ? { answers: [entry.requestId] } : {}),
	}
}

export function entriesModel(session: Session): EntriesModel {
	async function open(tallyId: string): Promise<{ tally: Tally; view: TallyView; unit: Unit } | undefined> {
		const tally = await session.tally(tallyId)
		if (!tally) return undefined
		const view = await tally.read()
		return { tally, view, unit: session.unitOf(view) }
	}

	return {
		async listEntries(tallyId) {
			const found = await open(tallyId)
			if (!found) return failed<Entry[]>('not-found', `no tally ${tallyId}`)
			return ok((await found.tally.history()).map(e => entryOf(e, found.unit)))
		},

		async readEntry(tallyId, entryId) {
			const found = await open(tallyId)
			if (!found) return failed<Entry>('not-found', `no tally ${tallyId}`)
			const entry = (await found.tally.history()).find(e => e.id === entryId)
			return entry ? ok(entryOf(entry, found.unit)) : failed('not-found', `no entry ${entryId}`)
		},

		async previewEntry(tallyId, paying) {
			const found = await open(tallyId)
			if (!found) return failed<Preview>('not-found', `no tally ${tallyId}`)
			const { view, unit } = found
			// Paying lowers this party's balance and uses this party's room to spend.
			const after = view.balances.settled.units - paying.units
			const room = view.balances.capacity.canSend.units - paying.units
			return ok({
				balanceAfter: balanceOf(after, unit),
				roomAfter: amount(Math.max(0, room), unit),
				...(room < 0 ? { beyondLimit: amount(-room, unit) } : {}),
			})
		},

		async recordEntry(tallyId, entry) {
			const found = await open(tallyId)
			if (!found) return failed<Entry>('not-found', `no tally ${tallyId}`)
			const answers = entry.answers ?? []
			if (answers.length > 1) return unsupported('One payment answering several requests', 'feat-invoice-lifecycle')
			// `actId` is minted once per payment by the screen and held across attempts, so a
			// retry after a lost reply is reported rather than paid twice (taleus-core `pay`).
			const paid = await found.tally.pay({
				id: entry.actId,
				amount: toCore(entry.amount, found.view.denomination),
				...(entry.memo ? { memo: entry.memo } : {}),
				...(answers[0] ? { answers: answers[0] } : {}),
			})
			if (!paid.ok) return refused(paid.refusal)
			return ok(entryOf(paid.value, found.unit))
		},
	}
}

export function requestsModel(session: Session): RequestsModel {
	function requestOf(request: CorePaymentRequest, view: TallyView, unit: Unit, now: number): PaymentRequest {
		const state = requestStateOf(request.state)
		const answered = state === 'answered'
		return {
			id: request.id,
			tallyId: view.ref.id,
			direction: request.from === 'me' ? 'asked-by-me' : 'asked-of-me',
			...(request.from === 'counterparty'
				? { requester: { sid: view.counterparty.sid, name: nameOf(view.counterparty.sid, view.counterparty.certificate) } }
				: {}),
			amount: amount(request.amount.units, unit),
			...(request.memo ? { memo: request.memo } : {}),
			asked: instantOf(request.requestedOn),
			outstandingDays: answered ? 0 : daysSince(instantOf(request.requestedOn), now),
			applied: amount(answered ? request.amount.units : 0, unit),
			stillAsked: amount(answered ? 0 : request.amount.units, unit),
			state,
		}
	}

	async function all(tallyId?: string): Promise<PaymentRequest[]> {
		const now = session.now().getTime()
		const out: PaymentRequest[] = []
		for (const { tally, view } of await session.views()) {
			if (tallyId && view.ref.id !== tallyId) continue
			const unit = session.unitOf(view)
			for (const request of await tally.requests()) out.push(requestOf(request, view, unit, now))
		}
		return out.sort((a, b) => b.asked.localeCompare(a.asked))
	}

	async function find(requestId: string) {
		return (await all()).find(r => r.id === requestId)
	}

	return {
		async listRequests(tallyId) {
			return ok(await all(tallyId))
		},

		async createRequest(tallyId, ask) {
			const tally = await session.tally(tallyId)
			if (!tally) return failed<PaymentRequest>('not-found', `no tally ${tallyId}`)
			const view = await tally.read()
			const asked = await tally.requestPayment({
				amount: toCore(ask.amount, view.denomination),
				...(ask.memo ? { memo: ask.memo } : {}),
			})
			if (!asked.ok) return refused(asked.refusal)
			const created = await find(asked.value.id)
			return created ? ok(created) : failed('not-found', 'the request was made but cannot be read back')
		},

		async readRequest(requestId) {
			const request = await find(requestId)
			return request ? ok(request) : failed('not-found', `no request ${requestId}`)
		},

		async declineRequest(requestId) {
			const request = await find(requestId)
			if (!request) return failed<PaymentRequest>('not-found', `no request ${requestId}`)
			const tally = await session.tally(request.tallyId)
			if (!tally) return failed('not-found', `no tally ${request.tallyId}`)
			// The reason is the payer's own note; the core records the refusal, not why.
			const declined = await tally.declinePayment(requestId)
			if (!declined.ok) return refused(declined.refusal)
			return ok((await find(requestId)) as PaymentRequest)
		},

		async withdrawRequest() {
			return unsupported('Withdrawing a request', 'feat-invoice-lifecycle')
		},

		async applyToRequest() {
			return unsupported('Paying part of a request', 'feat-invoice-lifecycle')
		},
	}
}
