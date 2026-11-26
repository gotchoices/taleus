description: When a lift node receives a transaction record that fails validation, it throws without logging what was wrong, so an operator has no record of the bad input — the original ChipNet code logged it. Restore that visibility.
files: packages/tallynet/src/consensus/participant.ts, packages/tallynet/docs/chipnet-review.md
difficulty: easy
----

A minor regression found by the ChipNet regression check (`packages/tallynet/docs/chipnet-review.md` § Regression check, consensus table row "Invalid-record logging"). It was previously noted as "folded into `bug-tallynet-push-echo-suppression`", but that ticket's scope only ever covered the peer-record echo suppression — it never touched logging — so this concern was left untracked when that ticket completed. This ticket carries it forward on its own.

## What ChipNet did

ChipNet's participant had a `logInvalid` path (`../chipnet/src/transaction/participant.ts:65`) that logged the whole offending record whenever validation threw. An operator watching a node could see *which* record was rejected and *why*.

## What TallyNet does

`TrxParticipant.update` (`packages/tallynet/src/consensus/participant.ts:144`) has no try/catch. In `validateAndMerge`:
- A `core-mismatch` (incoming record's immutable core differs from the stored copy) does emit a `signature-rejected` trace event before throwing (`:194`).
- But a **new-record rule failure** (`newRecordRules.runAndCheck`, `:190`) throws straight out of `update` with no trace and no log at the participant boundary.

So an invalid record pushed by a peer surfaces only as an unhandled rejection in whatever called `update`; the participant itself leaves no greppable record of what it refused. This contradicts the repo rule "Don't eat exceptions w/o at least logging" — here the exception is not eaten, but the participant that *has* the record in hand is the natural place to log it, and does not.

## Expected behaviour

When a record fails validation at the participant boundary, the node should emit something an operator can see — a trace event (consistent with the existing `signature-rejected` / `record-received` trace vocabulary) and/or a `this.log(...)` line — identifying the transaction and the reason, before (or instead of) propagating the throw. Decide whether rule-failures should also propagate as today (a relay that throws on every invalid push may be a DoS surface) or be swallowed-after-logging like a dropped signature; ChipNet logged and continued. Match the trace/log shape already used in this file rather than inventing a new one.

## Scope notes

- Not a correctness defect — consensus outcomes are unaffected; this is observability/hardening, hence `debt-`.
- Keep the existing `core-mismatch` trace; this is about the currently-silent new-record rule-failure path (and any other validation throw) also being visible.
- Reachable today: any peer (or the originator) that delivers a malformed record triggers it.
