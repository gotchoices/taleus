import type { Refusal, RefusalCode, Result } from './types.js'

/**
 * Turning the engine's refusal into something a consumer can act on -- without throwing away
 * what it said.
 *
 * Quereus reports a failed write by naming the constraint: `CHECK constraint failed:
 * WithinCreditLimits`. That name is the most useful diagnostic in the system, and the
 * row-level suite asserts on it. So a `Refusal` carries **both**: a stable `code` to branch
 * on, and the raw `constraint` for anyone who needs to know exactly which rule fired.
 *
 * The mapping is deliberately incomplete. A constraint with no entry comes back as `refused`
 * with its name intact, which is strictly better than guessing -- a wrong code is worse than
 * no code, because a caller will believe it.
 */

const BY_CONSTRAINT: Record<string, RefusalCode> = {
	WithinCreditLimits: 'credit-limit',
	WithinReservedCredit: 'credit-limit',
	ClosingReducesBalance: 'closing',
	ClosingReducesReserved: 'closing',
	SignerAuthorized: 'not-authorized',
	StockSignerAuthorized: 'not-authorized',
	FoilSignerAuthorized: 'not-authorized',
	RevokerAuthorized: 'not-authorized',
	AuthKeyAuthorized: 'not-authorized',
	DeclinerIsPayer: 'not-authorized',
	CounterpartyIsOther: 'not-authorized',
	SignatureValid: 'bad-signature',
	StockSignatureValid: 'bad-signature',
	FoilSignatureValid: 'bad-signature',
	ContractSignatureValid: 'bad-signature',
	RefereeVoidValid: 'bad-signature',
	InvoiceLink: 'request-mismatch',
	NotPaid: 'request-mismatch',
	InvoiceExists: 'not-found',
	PendingExists: 'not-found',
	StockTermsExist: 'not-found',
	FoilTermsExist: 'not-found',
	EffectiveDateValid: 'terms',
	ExpiryValid: 'terms',
	DenominationImmutable: 'terms',
	BalanceCorrect: 'terms',
	RevisionMonotonicInt: 'already-exists',
	NotLastKey: 'not-authorized',
}

/**
 * Every message on an error and its `cause` chain, joined.
 *
 * On a real strand a refusal is not always on the outermost error. Sereus's schema guide is
 * explicit that a *concurrent* duplicate can surface as a plain `Error` whose constraint text
 * sits on the `cause` chain, while a sequential one arrives as a `ConstraintError` -- so match
 * on the text, across the whole chain, rather than on the error's type or top message.
 */
export function chainText(error: unknown): string {
	const messages: string[] = []
	const seen = new Set<unknown>()
	for (let e: unknown = error; e !== undefined && e !== null && !seen.has(e); ) {
		seen.add(e)
		messages.push(e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e))
		e = e instanceof Error ? e.cause : undefined
	}
	return messages.join(' <- ')
}

/**
 * The unique key a refusal names, if it is a uniqueness refusal.
 *
 * Quereus spells these three ways: `Invoice PK` for a primary key, `Ledger (InvoiceId)` for a
 * unique index, and `Strand.Id` -- the form Sereus documents for a concurrent refusal.
 */
export function uniqueViolation(error: unknown): { table: string; key: string } | undefined {
	const match = /UNIQUE constraint failed:\s*([A-Za-z0-9_]+)(?:\s+PK\b|\s*\(([^)]*)\)|\.([A-Za-z0-9_]+))/.exec(
		chainText(error),
	)
	if (!match) return undefined
	return { table: match[1], key: match[2] ?? match[3] ?? 'PK' }
}

/**
 * Uniqueness refusals whose meaning is more specific than "that already exists". A second
 * chit answering one invoice is refused by the unique index on `Ledger (InvoiceId)` -- and to
 * the payer that is "this request is already answered", the `request-mismatch` case.
 */
const BY_UNIQUE: Record<string, RefusalCode> = {
	'Ledger (InvoiceId)': 'request-mismatch',
}

/** `CHECK constraint failed: WithinCreditLimits` → `WithinCreditLimits`. */
function constraintIn(text: string): string | undefined {
	const unique = /UNIQUE constraint failed:\s*([A-Za-z0-9_]+(?:\s+PK|\s*\([^)]*\)|\.[A-Za-z0-9_]+)?)/.exec(text)
	if (unique) return unique[1].replace(/\s+/g, ' ')
	return /constraint failed:\s*([A-Za-z0-9_.]+)/.exec(text)?.[1]
}

export function refusalFrom(error: unknown, refusedBy: Refusal['refusedBy'] = 'both'): Refusal {
	const message = error instanceof Error ? error.message : String(error)
	if (error instanceof Error && error.name === 'DisagreementError') {
		return { code: 'disagreement', message, refusedBy: 'self' }
	}
	const text = chainText(error)
	const constraint = constraintIn(text)
	// Quereus names a column-level CHECK `_check_<Column>`. Every one in this schema is a
	// value-validity rule -- a bound below a target, a non-positive amount, a malformed date --
	// so they all land on `terms` rather than each needing an entry.
	const mapped = constraint
		? (BY_UNIQUE[constraint] ??
			BY_CONSTRAINT[constraint] ??
			(constraint.startsWith('_check_') ? 'terms' : undefined))
		: undefined
	const code: RefusalCode = mapped ?? (/UNIQUE constraint failed/.test(text) ? 'already-exists' : 'refused')
	return { code, message, refusedBy, ...(constraint ? { constraint } : {}) }
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const no = <T>(refusal: Refusal): Result<T> => ({ ok: false, refusal })

/** Run an act, turning an engine refusal into a value and leaving real faults to throw. */
export async function attempt<T>(act: () => Promise<T>): Promise<Result<T>> {
	try {
		return ok(await act())
	} catch (error) {
		const isRefusal =
			/constraint failed/.test(chainText(error)) ||
			(error instanceof Error && error.name === 'DisagreementError')
		if (!isRefusal) throw error
		return no(refusalFrom(error))
	}
}

/** A refusal the engine raised itself, before anything reached a store. */
export function locally(code: RefusalCode, message: string): Refusal {
	return { code, message, refusedBy: 'self' }
}
