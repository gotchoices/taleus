import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import {
	type Result,
} from '../types.js'
import type { AgreementDocument, TermsChange, TermsProposal, TermsRecord, Closing, TallyDetail, UnrecordedAct } from '../tally.js'

/**
 * One tally, read from this party's side (stories 04, 07).
 *
 * Keyed by id, because a party has many and the screen is only ever asking
 * about one of them.
 */
export async function readTally(tallyId: string): Promise<Result<TallyDetail>> {

	const data = fixtureFor(getVariant())
	if (data.missing?.includes(tallyId)) {
		return {
			ok: false,
			error: { kind: 'tally-missing', message: `This device holds no tally ${tallyId}.`, retryable: false },
		}
	}
	const found = data.tallies[tallyId]
	if (!found) {
		return {
			ok: false,
			error: { kind: 'not-found', message: `No tally ${tallyId}.`, retryable: false },
		}
	}
	const close = closes[tallyId]
	const closing = close === undefined ? found.closing : (close ?? undefined)
	return {
		ok: true,
		value: {
			...found,
			closing,
			// Closed is final (story 05 step 6): a close request does not bring it back to closing.
			state: found.state === 'Closed' ? 'Closed' : closing ? 'Closing' : found.state === 'Closing' ? 'Open' : found.state,
		},
	}
}

/**
 * How a tally's terms got to where they are (story 07 steps 3-4).
 *
 * A tally with nothing recorded here has never been amended, which is the
 * story's `empty` case: the two sets in force *are* the whole history, so they
 * are derived rather than demanding a fixture that says the same thing twice.
 */
export async function readTerms(tallyId: string): Promise<Result<TermsRecord>> {
	const fixture = termsFixtureFor(getVariant())
	const history = fixture.history[tallyId]
	if (history) {
		return { ok: true, value: { history, proposal: fixture.proposals[tallyId] } }
	}
	const tally = await readTally(tallyId)
	if (!tally.ok) {
		return tally
	}
	return { ok: true, value: { history: openingOnly(tally.value), proposal: fixture.proposals[tallyId] } }
}

function openingOnly(tally: TallyDetail): TermsChange[] {
	return (['mine', 'theirs'] as const).map(side => ({
		id: `${tally.id}-${side}-opening`,
		side,
		by: side === 'mine' ? ('me' as const) : ('them' as const),
		creditLimit: tally.terms[side].creditLimit,
		noticeDays: tally.terms[side].noticeDays,
		agreed: tally.terms[side].effective,
		effective: tally.terms[side].effective,
		governs: 'everything' as const,
		opening: true,
	}))
}

/**
 * The contract itself. Story 07's error case is this failing while the terms in
 * force stay readable, so it is a separate read rather than part of the tally.
 */
export async function readAgreement(agreementId: string): Promise<Result<AgreementDocument>> {
	const found = termsFixtureFor(getVariant()).documents[agreementId]
	if (!found) {
		return {
			ok: false,
			error: {
				kind: 'unretrievable',
				message: `The agreement ${agreementId} could not be fetched.`,
				retryable: true,
			},
		}
	}
	return { ok: true, value: found }
}

interface TermsFixture {
	history: Record<string, TermsChange[]>
	proposals: Record<string, TermsProposal>
	documents: Record<string, AgreementDocument>
}

function termsFixtureFor(variant: string): TermsFixture {
	switch (variant) {
		case 'error':
			return fixture('terms.error') as TermsFixture
		default:
			return fixture('terms.happy') as TermsFixture
	}
}

/** Mock writes, held in memory as elsewhere. */
let closes: Record<string, Closing | null> = {}

/**
 * Story 05 step 1: either party may ask, without the other's agreement. A second
 * request changes nothing (path F) — one was already enough.
 */
export async function requestClose(tallyId: string): Promise<Result<TallyDetail>> {
	const current = await readTally(tallyId)
	if (!current.ok) {
		return current
	}
	const already = current.value.closing
	closes = {
		...closes,
		[tallyId]: {
			requestedBy: already ? (already.requestedBy === 'me' ? 'me' : 'both') : 'me',
			requested: already?.requested ?? new Date().toISOString(),
			settleBy: already?.settleBy,
			offerWriteOff: already?.offerWriteOff,
		},
	}
	return readTally(tallyId)
}

export function resetCloses(): void {
	closes = {}
}

/** The variant's refused acts, less those the party has seen. */
export async function listUnrecorded(tallyId: string): Promise<Result<UnrecordedAct[]>> {
	const current = await readTally(tallyId)
	if (!current.ok) {
		return current
	}
	const listed = unrecordedFor(getVariant())[tallyId] ?? []
	return { ok: true, value: listed.filter(act => !acknowledged.has(act.id)) }
}

export async function acknowledgeUnrecorded(tallyId: string, actId: string): Promise<Result<void>> {
	const current = await readTally(tallyId)
	if (!current.ok) {
		return current
	}
	acknowledged.add(actId)
	return { ok: true, value: undefined }
}

const acknowledged = new Set<string>()

export function resetUnrecorded(): void {
	acknowledged.clear()
}

function unrecordedFor(variant: string): Record<string, UnrecordedAct[]> {
	if (variant !== 'error') {
		return {}
	}
	return (fixture('tally.error') as { unrecorded?: Record<string, UnrecordedAct[]> }).unrecorded ?? {}
}

interface TallyFixture {
	tallies: Record<string, TallyDetail>
	/** Tallies this phone no longer holds: read as the engine answers one (`tally-missing`). */
	missing?: string[]
}

function fixtureFor(variant: string): TallyFixture {
	switch (variant) {
		case 'closing':
			return fixture('tally.closing') as TallyFixture
		case 'error':
			return fixture('tally.error') as TallyFixture
		default:
			return fixture('tally.happy') as TallyFixture
	}
}
