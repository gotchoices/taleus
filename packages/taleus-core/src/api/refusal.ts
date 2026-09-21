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

/** `CHECK constraint failed: WithinCreditLimits` → `WithinCreditLimits`. */
function constraintIn(message: string): string | undefined {
	const check = /constraint failed:\s*([A-Za-z0-9_.]+)/.exec(message)
	if (!check) return undefined
	// A UNIQUE violation names `Table PK` or `Table.Column`; the first word is the useful half.
	return check[1]
}

export function refusalFrom(error: unknown, refusedBy: Refusal['refusedBy'] = 'both'): Refusal {
	const message = error instanceof Error ? error.message : String(error)
	if (error instanceof Error && error.name === 'DisagreementError') {
		return { code: 'disagreement', message, refusedBy: 'self' }
	}
	const constraint = constraintIn(message)
	// Quereus names a column-level CHECK `_check_<Column>`. Every one in this schema is a
	// value-validity rule -- a bound below a target, a non-positive amount, a malformed date --
	// so they all land on `terms` rather than each needing an entry.
	const mapped = constraint
		? (BY_CONSTRAINT[constraint] ?? (constraint.startsWith('_check_') ? 'terms' : undefined))
		: undefined
	const code: RefusalCode =
		mapped ?? (/UNIQUE constraint failed/.test(message) ? 'already-exists' : 'refused')
	return { code, message, refusedBy, ...(constraint ? { constraint } : {}) }
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const no = <T>(refusal: Refusal): Result<T> => ({ ok: false, refusal })

/** Run an act, turning an engine refusal into a value and leaving real faults to throw. */
export async function attempt<T>(act: () => Promise<T>): Promise<Result<T>> {
	try {
		return ok(await act())
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const isRefusal =
			/constraint failed/.test(message) || (error instanceof Error && error.name === 'DisagreementError')
		if (!isRefusal) throw error
		return no(refusalFrom(error))
	}
}

/** A refusal the engine raised itself, before anything reached a store. */
export function locally(code: RefusalCode, message: string): Refusal {
	return { code, message, refusedBy: 'self' }
}
