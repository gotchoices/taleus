/**
 * The resource port: where the **host** (Taleus) holds and releases the value on its tally edges and,
 * if it is a voter, casts the settlement vote. TallyNet drives the promise/commit protocol; the host
 * owns the money. Ported from ChipNet's `TrxParticipantResource` (`participant-resource.ts:12-21`) with
 * the **ordering bug fixed**: ChipNet called `promise` (the hold) *before* `shouldPromise` decided
 * (docs/chipnet-review.md § Transaction module defects, `:75-77`), so a declined promise still held
 * value until release. Here the gate runs first and `promise` is only ever called after
 * `shouldPromise` has returned true — a declined promise holds nothing.
 *
 * Every hook receives a {@link ResourceContext}: our own member entry, our in/out links (with the real
 * link ids resolved from the discovery nonce→linkId map where we own them), and the current record.
 * The host reads the record's edge terms off these links to decide — TallyNet itself never interprets
 * terms (see docs/design.md § Multiple denominations, item 4).
 *
 * A host backs this with real persistence of its holds; TallyNet supplies the release-once guarantee
 * (via the store's release flag, see `participant.ts`), so `release` is called **exactly once** per
 * transaction even across a restart. Nothing here is persisted or digested by TallyNet.
 */

import type { DependentMember } from '../discovery/types.js'
import type { TrxRecord } from './types.js'

/**
 * One of our links, as the resource hooks see it: the edge's per-session `nonce`, the real `linkId`
 * (present only for links we own — ours will be in the nonce→linkId map; a peer's edge stays
 * `undefined`), the `source`/`target` member keys, and the negotiated per-intent terms. A circular
 * lift puts our member on more than one link, so our in/out link lists may each hold several.
 */
export interface OurLink<TTerms> {
	nonce: string
	linkId?: string
	source: string
	target: string
	intents: Record<string, TTerms>
}

/**
 * What every resource hook is handed: our member entry in the topology, our incoming and outgoing
 * links, and the record under consideration. `inLinks` are edges whose `target` is us; `outLinks` are
 * edges whose `source` is us.
 */
export interface ResourceContext<TTerms, TPayload> {
	member: DependentMember
	inLinks: OurLink<TTerms>[]
	outLinks: OurLink<TTerms>[]
	record: TrxRecord<TTerms, TPayload>
}

/**
 * The host's value-holding/releasing/voting port. All hooks may be sync or async; every call site
 * awaits them.
 */
export interface TrxParticipantResource<TTerms, TPayload> {
	/**
	 * Proposal gate — the **first** policy check at promise time (only an expired code refuses ahead of
	 * it), before {@link shouldPromise}. Accept the record's **proposal parameters for OUR
	 * participation**: its voter set, its consensus method, and its lift contract, weighed together.
	 * `false` → we sign `NP` (no-promise) and nothing is held; any `NP` voids the lift. Default when
	 * omitted: `true` (accept — today's behaviour). A thrown error is treated exactly as `false` (`NP`,
	 * logged).
	 *
	 * Pure host **policy**: TallyNet enforces only verified signatures, the strict-majority+threshold
	 * invariant and (later) the deadline. "Refuse a thin/stacked voter set" lives HERE (e.g. the
	 * simulator's voter-model policy), never in the protocol — the protocol will settle even a
	 * lone-voter set per the threshold.
	 *
	 * The {@link ResourceContext} (shared with {@link shouldPromise}) exposes everything principle 0
	 * ("no global rules; each node decides") needs:
	 *   - the full **voter set** — `ctx.record.topology.members` whose `types` include `'V'` (a referee
	 *     is a `'V'` that is not also `'P'`);
	 *   - the **consensus method + threshold** — `ctx.record.method` (`{ weighting, thresholdNum, thresholdDen }`);
	 *   - the **deadline** — `expiresAt(ctx.record.transactionCode)`;
	 *   - the **lift contract CID** — `ctx.record.liftContract` (absent when none);
	 *   - our **own edge terms** — the negotiated per-intent terms on `ctx.inLinks` / `ctx.outLinks`.
	 */
	acceptsProposal?(ctx: ResourceContext<TTerms, TPayload>): boolean | Promise<boolean>

	/**
	 * Terms gate — runs **after** {@link acceptsProposal}, before any value is held. `false` → we sign
	 * `NP` (no-promise) and nothing is held. Default when omitted: `true`. This is the host's
	 * promise-time terms check (does the record's edge terms match our current quote/trading
	 * variables?). See {@link acceptsProposal} for the full list of what the shared
	 * {@link ResourceContext} exposes (voter set, method + threshold, deadline, contract CID, per-link
	 * terms). A thrown error is treated exactly as `false` (`NP`, logged).
	 */
	shouldPromise?(ctx: ResourceContext<TTerms, TPayload>): boolean | Promise<boolean>

	/**
	 * Hold the value on our edges. **Throw to refuse** → we sign `NP` and log the reason. Only ever
	 * called after {@link shouldPromise} returned true, so a refusal (false or throw) never leaves
	 * value held.
	 */
	promise(ctx: ResourceContext<TTerms, TPayload>): void | Promise<void>

	/**
	 * Release held value, called **exactly once** per transaction. `success` = committed (true) vs
	 * voided (false). Must be idempotent across restarts: TallyNet gates it on the store's release
	 * flag, but a host that also tracks its own holds should tolerate a repeat gracefully.
	 */
	release(ctx: ResourceContext<TTerms, TPayload> & { success: boolean }): void | Promise<void>

	/**
	 * Voter vote gate (members whose `types` include `V` only). `false` → we sign `NC` (no-commit /
	 * void). Default when omitted: `true`.
	 */
	shouldCommit?(ctx: ResourceContext<TTerms, TPayload>): boolean | Promise<boolean>

	/**
	 * Voter only: opaque per-edge settlement data to ride alongside our `C`/`NC` signature as its
	 * `attachment` (see docs/design.md § The commit attachment seam). TallyNet never inspects what this
	 * returns — it travels by union with the signature and is not part of the signed preimage. Default
	 * when omitted: no attachment.
	 */
	resolveAttachment?(decision: 'C' | 'NC', ctx: ResourceContext<TTerms, TPayload>): unknown
}
