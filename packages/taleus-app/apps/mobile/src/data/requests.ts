import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { daysSince, engineAbsent, type Amount, type Instant, type Result } from './types'

/** Which way a request runs, from the reading party's side (story 21). */
export type RequestDirection = 'asked-of-me' | 'asked-by-me'

export interface PaymentRequest {
	id: string
	tallyId: string
	direction: RequestDirection
	requester?: { sid: string; name: string }
	amount: Amount
	memo?: string
	asked: Instant
	/**
	 * How long it has been outstanding. Derived here rather than stored: the
	 * engine hands over `asked`, and the same derivation runs in engine mode.
	 * Requests age; they do not expire.
	 */
	outstandingDays: number
	applied: Amount
	stillAsked: Amount
	state: 'waiting' | 'part-answered' | 'answered' | 'refused' | 'withdrawn'
}

/** Requests on a tally, or across all tallies when no tally is named (21, 22, 24). */
export async function listRequests(tallyId?: string): Promise<Result<PaymentRequest[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const all = fixtureFor(getVariant()).requests ?? []
	const everything = [...asked, ...all]
	const mine = tallyId ? everything.filter(r => r.tallyId === tallyId) : everything
	return { ok: true, value: mine.map(age) }
}

function age(request: Omit<PaymentRequest, 'outstandingDays'>): PaymentRequest {
	const answer = answers[request.id]
	const applied = answer?.applied ?? request.applied
	return {
		...request,
		state: answer?.state ?? request.state,
		applied,
		stillAsked: { units: Math.max(0, request.amount.units - applied.units) },
		outstandingDays: daysSince(request.asked),
	}
}

function fixtureFor(variant: string): { requests?: PaymentRequest[] } {
	switch (variant) {
		case 'empty':
			return require('../../mock/data/requests.empty.json') as { requests?: PaymentRequest[] }
		default:
			return require('../../mock/data/requests.happy.json') as { requests?: PaymentRequest[] }
	}
}

/** Requests this party made in this session, held in memory as elsewhere. */
let asked: PaymentRequest[] = []

/**
 * Story 21: a request is the requester's own statement of what they think is
 * owed. It obliges the payer to nothing by itself, and it does not tick — it
 * stands until answered or withdrawn.
 */
export async function createRequest(
	tallyId: string,
	ask: { amount: Amount; memo?: string },
): Promise<Result<PaymentRequest>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const made: PaymentRequest = {
		id: `request:new-${Date.now().toString(36)}`,
		tallyId,
		direction: 'asked-by-me',
		amount: ask.amount,
		memo: ask.memo,
		asked: new Date().toISOString(),
		outstandingDays: 0,
		applied: { units: 0 },
		stillAsked: ask.amount,
		state: 'waiting',
	}
	asked = [made, ...asked]
	return { ok: true, value: made }
}

/** Answers this party gave in this session, held in memory as elsewhere. */
let answers: Record<string, { state: PaymentRequest['state']; applied?: Amount; why?: string }> = {}

/** One request by id, from either side of it (stories 21, 22). */
export async function readRequest(requestId: string): Promise<Result<PaymentRequest>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const all = await listRequests()
	if (!all.ok) {
		return all
	}
	const found = all.value.find(r => r.id === requestId)
	if (!found) {
		return {
			ok: false,
			error: { kind: 'not-found', message: `No request ${requestId}.`, retryable: false },
		}
	}
	return { ok: true, value: found }
}

/**
 * Story 22 path A: declining costs nothing and moves nothing. The requester is
 * told, and the request stops waiting on the payer — neither is left with it
 * nagging or with an answer that will never come.
 */
export async function declineRequest(requestId: string, why?: string): Promise<Result<PaymentRequest>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	answers = { ...answers, [requestId]: { state: 'refused', why } }
	return readRequest(requestId)
}

/** Story 21 path C: asking was the requester's act, and so is unasking. */
export async function withdrawRequest(requestId: string): Promise<Result<PaymentRequest>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	answers = { ...answers, [requestId]: { state: 'withdrawn' } }
	return readRequest(requestId)
}

/**
 * Story 22 path B: a request may be answered in full, in part, or not at all.
 * Nothing pretends $70 settled $95.
 */
export async function applyToRequest(requestId: string, applied: Amount): Promise<Result<PaymentRequest>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const current = await readRequest(requestId)
	if (!current.ok) {
		return current
	}
	const total = current.value.applied.units + applied.units
	const still = Math.max(0, current.value.amount.units - total)
	answers = {
		...answers,
		[requestId]: { state: still === 0 ? 'answered' : 'part-answered', applied: { units: total } },
	}
	return readRequest(requestId)
}

export function resetRequests(): void {
	asked = []
	answers = {}
}
