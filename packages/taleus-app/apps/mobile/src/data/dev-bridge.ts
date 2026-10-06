/**
 * Development-only hooks for driving the app from a script (`scripts/dev-drive.mjs`), after
 * sereus-chat's `diagnostics/dev-bridge.ts`.
 *
 * Driving two phones through their screens measured the harness as much as the app: keyboards
 * autocorrected names, a warning toast covered buttons, and a tap that never landed looked like
 * a slow join. These call the same model the screens call, reached over Metro's inspector
 * (`Runtime.evaluate`), with no UI in between.
 *
 * Hermes's inspector does not await promises, so an async call is started with
 * `__taleusDev.start(id, method, ...args)` and its outcome collected with `__taleusDev.take(id)`:
 * `undefined` while pending, then `{ ok, value }` or `{ ok: false, error }`.
 *
 * Installed only in a development build.
 */
import type { TaleusModel } from 'taleus-model'

const USD = { denom: 'iso4217:USD', scale: 2 }
const usd = (units: number) => ({ units, ...USD })

type Outcome = { ok: true; value: unknown } | { ok: false; error: string }

/** Unwrap a model `Result`, so a refusal arrives as an error the script can print. */
function value<T>(result: { ok: true; value: T } | { ok: false; error: { kind: string; message: string } }): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
	return result.value
}

function methods(model: TaleusModel, diagnostics: () => unknown) {
	return {
		/** Where this phone stands: its node and relay, its party. */
		async status() {
			return { node: diagnostics(), party: value(await model.party.readParty()) }
		},
		/** First run: an identity, under `name`. */
		async onboard(name: string) {
			if (!value(await model.party.readParty())) value(await model.party.createIdentity())
			value(await model.party.setDisplayName(name))
			return value(await model.party.readParty())
		},
		/** A USD invitation; returns its token, the thing a link carries. */
		async invite(creditLimitUnits = 50000) {
			const made = value(
				await model.invitations.createInvitation({
					unit: USD,
					creditLimit: usd(creditLimitUnits),
					noticeDays: 14,
					agreementId: 'cid:standard-tally-v1',
					goodForDays: 7,
				}),
			)
			return made.token
		},
		/** Take up an invitation as `name`, extending `creditLimitUnits` in return. */
		async accept(token: string, name: string, creditLimitUnits = 20000) {
			return value(
				await model.invitations.respondToInvitation(token, 'accept', {
					disclose: { name },
					creditLimit: usd(creditLimitUnits),
					noticeDays: 14,
				}),
			)
		},
		async tallies() {
			return value(await model.tallies.listTallies())
		},
		/** Record value given on a tally. */
		async pay(tallyId: string, units: number, memo: string) {
			return value(await model.entries.recordEntry(tallyId, { actId: `act:${Date.now()}`, amount: usd(units), memo }))
		},
	}
}

export function installDevBridge(model: TaleusModel, diagnostics: () => unknown): void {
	if (!__DEV__) return
	const calls = methods(model, diagnostics)
	const results = new Map<string, Outcome>()
	const bridge = {
		...calls,
		start(id: string, method: keyof typeof calls, ...args: unknown[]): true {
			const call = calls[method] as (...a: unknown[]) => Promise<unknown>
			call(...args).then(
				v => results.set(id, { ok: true, value: v }),
				(e: unknown) => results.set(id, { ok: false, error: e instanceof Error ? e.message : String(e) }),
			)
			return true
		},
		take(id: string): Outcome | undefined {
			const outcome = results.get(id)
			if (outcome) results.delete(id)
			return outcome
		},
	}
	;(globalThis as { __taleusDev?: typeof bridge }).__taleusDev = bridge
}
