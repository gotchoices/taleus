description: Work out how a tally offer lives and dies — how long it stays good, what happens when several are outstanding, and whether refusing one should be recorded or simply left to lapse.
files: packages/taleus/schema/draft1.qsql, docs/architecture.md, packages/taleus-app/design/stories/mobile/03-negotiate-terms.md
difficulty: medium
----
## Why this ticket exists

Negotiating a tally means going back and forth until both parties sign the same thing. The schema
today has `TallyContractProposal` as a **single row** (`primary key (/* 1 row */)`, and unlike its
neighbours it carries no `InsertOnly` constraint), so a counter-offer overwrites its predecessor and
nothing records what was proposed before. There is also no expiry: an offer made once stays
technically live forever.

MyCHIPs handled this with an explicit state machine (`draft` → `offer` → `open`, plus `void` for a
refused tally) and notified the other party when an offer was rejected. We have not decided whether
to keep that.

## Outcomes we're after

- A party can see the history of what was proposed, by whom, and what changed between versions —
  not just the latest offer.
- More than one offer can be outstanding at a time without the system becoming ambiguous.
- An offer stops being acceptable at some point, so a party is not exposed indefinitely to an offer
  they made long ago and forgot.
- When two offers somehow both end up fully signed, both parties independently reach the **same**
  answer about which one governs, without consulting a clock or each other.
- Terms can be renegotiated on a tally that is already open, by the same mechanism, with the unit of
  account staying fixed for the tally's life.

## A view we hold, offered as a case rather than a rule

On simultaneous acceptance, we lean toward **the later-drafted offer governing**. Precedence then
follows the proposal's own version ordering inside the tally rather than signature arrival times,
which sidesteps clock skew and needs no retraction protocol: a countersignature already in flight
when a revision is sent is not a problem to arbitrate, because both sides can compute the outcome
from data they already hold. If there is a cleaner rule, we would rather have the cleaner rule.

## The open question: expiry only, or explicit rejection too?

We initially leaned toward *expiry only* — an unsigned offer is nothing, so a party who does not
want it simply lets it lapse, and the offeror learns nothing. **Please treat that as one option, not
a requirement, and evaluate it against recording an explicit refusal.** This is an engine and
protocol question more than a presentation one; the app can present either.

Worth weighing:

- What the offeror can reasonably conclude from silence, and whether a vendor waiting at a counter
  needs better than a timeout.
- Whether a recorded refusal is a signed act (and therefore something a party can be held to) or
  merely a courtesy signal.
- Whether a refusal that is recorded can be distinguished from one that was never seen — an offline
  counterparty and an unwilling one look identical either way.
- Cost of an extra table and signing path versus the cost of a protocol that only ever ends in
  timeouts.
- Whether refusal interacts badly with the multiple-outstanding-offers case: refusing *which* offer?
- The schema already has `InvoiceDecline` as a precedent for a recorded refusal, which suggests the
  pattern is not foreign here.

Whatever is chosen, say so plainly in `docs/architecture.md`; the app-side rules
(`packages/taleus-app/design/specs/domain/rules.md`) and story 02's decline path will follow.

## Relationship to other work

`feat-schema-tally-state` proposes materializing lifecycle state as a view and anticipates a `Void`
state possibly needing an explicit signal — that question and this one are the same question. Settle
it here; let that ticket consume the answer.
