import { BUILT_IN_PUBLISHER, type TrustedPublisher } from '../agreement.js'
import type { Result } from '../types.js'

/** Mock writes, as in `party.ts`: enough to walk story 08, gone on restart. */
let trusted: TrustedPublisher[] = []

function list(): TrustedPublisher[] {
	return [{ domain: BUILT_IN_PUBLISHER, builtIn: true }, ...trusted]
}

export async function listTrusted(): Promise<Result<TrustedPublisher[]>> {
	return { ok: true, value: list() }
}

export async function trustPublisher(domain: string): Promise<Result<TrustedPublisher[]>> {
	if (domain !== BUILT_IN_PUBLISHER && !trusted.some(p => p.domain === domain)) {
		trusted = [...trusted, { domain, builtIn: false, since: new Date().toISOString().slice(0, 10) }]
	}
	return { ok: true, value: list() }
}

export async function untrustPublisher(domain: string): Promise<Result<TrustedPublisher[]>> {
	trusted = trusted.filter(p => p.domain !== domain)
	return { ok: true, value: list() }
}

export async function trustAgreement(_agreementId: string): Promise<Result<void>> {
	return { ok: true, value: undefined }
}

export function resetPublishers(): void {
	trusted = []
}
