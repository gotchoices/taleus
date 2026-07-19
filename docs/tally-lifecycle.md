# Tally Lifecycle, Governance, and the Rights Invariant

A tally is a two-party contract that evolves through negotiation, active use, and wind-down. This doc
covers the **state machine**, the **contract-governance** principles that decide who may do what, the
**rights invariant** every state transition must respect, and a taxonomy of the ways a tally can — and
cannot — get **wedged**.

## States

| State | Meaning | Schema-backed? |
|---|---|---|
| **Forming** | Strand exists; parties seating / negotiating; no bilaterally-signed contract yet | Derivable (no fully-signed `TallyContract`) |
| **Open** | Contract signed by both parties; ledger active | Derivable (highest fully-signed `TallyContract`) |
| **Closing** | A `CloseRequest` row exists; new credit frozen, only balance-reducing activity accepted | Yes — `CloseState = 'closing'` |
| **Closed** | Settled balance zero with no pending lift; terminal | Yes — `CloseState = 'closed'` |
| **Void** | Formation abandoned before a signed contract | Derivable (app-level) |

Only Closing/Closed are materialized today (the `CloseRequest` table, the `CloseState` view, and the two
closing gates). Forming / Open / Void are **derivable** from the proposal/contract tables but not yet
exposed as a view — a `TallyState` view is a natural, modest addition.

## The negotiation dance (preserve it)

MyCHIPs' negotiation was well-designed and carries over. A tally signed by **only one party is already a
contract-in-waiting** — a standing offer the other party can complete unilaterally by countersigning. The
raw material is in the schema:

- [`TallyContractProposal`](../packages/taleus/schema/draft1.qsql) — a one-sided, signed offer (the
  negotiation cursor): a contract CID + arguments (denomination, each party's operative `CreditTerms`
  revision), signed by the proposer.
- [`TallyContract`](../packages/taleus/schema/draft1.qsql) — bilaterally-signed acceptances, numbered; the
  highest fully-signed number governs.

So MyCHIPs' `draft → offer → open` with `H.`/`P.`/`B.` (holder/partner/both-signed) prefixes maps directly:
**offer** = a proposal signed by one side; **open** = both signatures on the same numbered contract; a
**counter-offer** = a new proposal/contract revision that supersedes. Progressive disclosure rides along:
certificates and terms are revisioned, so a party starts minimal and discloses more until the counterparty
is willing to countersign. What remains is to (a) materialize this as a state view and (b) decide how much
to enforce in-schema vs. leave to the app — tracked in [STATUS.md](STATUS.md).

## Contract governance

The tally is governed by the **contract between the parties**, which carries good-faith obligations on
both sides. That principle sets who may do what:

- **Direct (manual) chits are grantor-authorized, any time, for any reason.** A pledge is a voluntary
  obligation from the issuer to the counterparty. Issuing one can only *help* the recipient (worst case,
  it is uncollectable), so no countersignature is required — the issuer's signature alone stands.
- **Lift chits are automated and bounded by signed trading variables.** A lift chit is not a free-form
  pledge; it occurs only in accordance with the issuer's published [trading variables](trading-variables.md).
  Because a `PendingLift` is **self-signed by the issuer**, a party only ever commits what its own agent
  signs — conformance is agent-enforced, not a schema CHECK.
- **Good-faith timing.** If trading variables authorize a lift and, due to timing, a lift chit is signed
  just before the party records **newer** variables, the chit **is still valid and still that party's
  responsibility** — it was valid when signed, and the new directive binds only *later* lifts. This is
  already the schema's rationale: a referee-committed finalize is deliberately **exempt from re-gating**
  (once committed it must settle, or per-strand re-checks would break cross-strand atomicity). "Valid 2μs
  ago → still valid if acting in good faith."
- **Uncompensated pledges are reversible in good faith.** If a pledge is made and the expected
  consideration never arrives (I paid, you did not ship), the pledge is of no avail and should be reversed
  by the counterparty. The schema *permits* this: throughout Closing (and always while Open) a
  balance-reducing counter-chit is accepted. The schema provides the mechanism and the replicated
  evidence; enforcing good faith stays contractual.

**Why this is a more forgiving space than a blockchain.** On a public chain among strangers there is no
governing contract, so every edge case must be made cryptographically airtight. A tally — once duly opened
— has an **underlying contract with good-faith duties**, so a mistimed or uncompensated action is a
disputable matter resolvable under that contract, not necessarily a protocol-level catastrophe. The ledger
is replicated to both cadres, so every dispute has signed evidence.

## The rights invariant

Every gate, state, and transition is checked against one rule:

> The schema must **never permanently trap value** or **block a party from an action the contract
> entitles it to** — *except* where the trap requires the counterparty's **bad-faith act** (then it is a
> disputable contract breach, and the replicated ledger is the evidence) or a **temporary platform
> liveness failure** (which self-heals). A "wedge" that needs neither a bad actor nor a transient outage
> is a schema defect.

## Wedged-state taxonomy

Sorting every known failure mode by that invariant. Two broad classes: **direct-action** issues (open,
close, pledge — the current focus) and **lift** issues (third parties, referees — the tallyNet domain,
deferred).

### A. Real wedges — value trapped, no bad actor, no way out (need a decision/fix)

- **A1 — stuck pending lift (referee vanishes).** A `PendingLift` reserves credit but only the referee can
  resolve it; `Expiry` is advisory. A permanently-silent referee freezes that capacity forever and blocks
  reaching `Closed`. There is currently **no mutual-rescind path** for the two edge parties. → *lift domain*;
  [`feat-lift-timeout-release`](../tickets/backlog/feat-lift-timeout-release.md) (bilateral release is the
  contract-aligned candidate).
- **A2 — terminal close, no reopen.** `Closed` becomes terminal the instant the balance hits zero; a
  mistaken/uncompensated final payment cannot be reversed on that tally. → *direct-action*;
  [`debt-tally-close-no-reopen`](../tickets/backlog/debt-tally-close-no-reopen.md).

### B. Byzantine wedges — require a bad actor; disputable under contract

- **B1 — malicious single referee half-commits** (v1): signs commit to some edges, void to others → a
  non-atomic lift → an intermediary can lose value, possibly a **third party** with no contract with the
  referee. The one place the two-party contract backstop does not reach. → *lift domain*;
  [`feat-multi-referee-consensus`](../tickets/backlog/feat-multi-referee-consensus.md) and (speculative)
  [`feat-lift-healing`](../tickets/backlog/feat-lift-healing.md).
- **B2 — malicious counterparty unilateral rekey** (total-loss recovery): inherent to a two-party
  human-trust root, documented, out of scope by design. Disputable.
- **B3 — backdated chit** to dodge a credit-limit reduction: a bare pledge is harmless, but backdating
  defeats the notice period and, via lift capacity, can pull value from third parties on
  soon-to-be-withdrawn credit. Disputable (the signed date is visible to both). →
  [`debt-credit-gate-chit-date-backdating`](../tickets/backlog/debt-credit-gate-chit-date-backdating.md).

### C. Liveness-only — temporary, platform-level, self-healing

- **C1 — CP partition.** A cadre in the minority partition cannot commit — so it cannot pledge, pay down a
  closing tally, or **revoke a stolen key** until the partition heals, widening the key-compromise window.
  Not permanent. See [concurrency-model.md](concurrency-model.md) and [STATUS.md](STATUS.md).

### D. Looks stuck, but is correct (no right lost)

- **D1 — a closing tally that never reaches zero** because the debtor will not pay: **not** a wedge. The
  debt stays fully recorded and collectible; you cannot force payment by closing, and should not be able
  to. The creditor keeps its right to be paid; the tally hibernates in Closing with the balance intact.
- **D2 — a one-sided-signed contract never countersigned:** no ledger, no value at risk. It is the
  contract-in-waiting; either party abandons it (Void).

## Open questions

- Materialize a `TallyState` view (Forming/Open/Void) and decide the in-schema vs. app enforcement split.
- Resolve A1 (mutual-rescind vs. timeout) and A2 (reopen/withdraw vs. accept-as-terminal) — see the tickets.
- The lift-domain wedges (B1, healing) are deferred to the tallyNet layer; not near-term.
