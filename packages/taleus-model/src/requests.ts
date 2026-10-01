/** requests: shapes and policy shared by every implementation of the model. */
import type { Amount, Instant, Result } from './types.js'

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

/** What a screen can read and do about requests. Both the mock and the engine implement it. */
export interface RequestsModel {
	/** Requests on a tally, or across all tallies when no tally is named (21, 22, 24). */
	listRequests(tallyId?: string): Promise<Result<PaymentRequest[]>>
	/**
	 * Story 21: a request is the requester's own statement of what they think is
	 * owed. It obliges the payer to nothing by itself, and it does not tick — it
	 * stands until answered or withdrawn.
	 */
	createRequest(tallyId: string, ask: { amount: Amount; memo?: string }): Promise<Result<PaymentRequest>>
	/** One request by id, from either side of it (stories 21, 22). */
	readRequest(requestId: string): Promise<Result<PaymentRequest>>
	/**
	 * Story 22 path A: declining costs nothing and moves nothing. The requester is
	 * told, and the request stops waiting on the payer — neither is left with it
	 * nagging or with an answer that will never come.
	 */
	declineRequest(requestId: string, why?: string): Promise<Result<PaymentRequest>>
	/** Story 21 path C: asking was the requester's act, and so is unasking. */
	withdrawRequest(requestId: string): Promise<Result<PaymentRequest>>
	/**
	 * Story 22 path B: a request may be answered in full, in part, or not at all.
	 * Nothing pretends $70 settled $95.
	 */
	applyToRequest(requestId: string, applied: Amount): Promise<Result<PaymentRequest>>
}
