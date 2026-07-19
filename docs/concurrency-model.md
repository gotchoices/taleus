# Concurrency Model

Taleus puts **all** integrity in the database: every tally row is signature-gated by a Quereus `CHECK`,
and there is no trusted server to enforce anything. This doc explains why that stays safe when two of a
party's devices — or the two parties — act concurrently, and names the two platform assumptions it rests
on.

## The schema is (almost) a grow-only set

Nearly every tally table is **insert-only** and **monotonic-revision** — state advances by appending a
new row, never mutating one. That shape is essentially a **grow-only-set CRDT**: most writes either
commute or conflict cleanly on a primary key. Concurrent `PartyKey` adds from two surviving devices, for
example, both compute revision `N+1` and **collide on the `(Sid, Revision)` primary key**; Optimystic's
write ordering picks a winner and the loser retries against the new max. No constraint assumes a single
writer.

Only a **handful** of constraints reason about *absence or count across rows that do not share a key* —
and those are the ones whose safety depends on the substrate's concurrency model:

- `PartyKeyRevocation.NotLastKey` — two concurrent revocations of **different** keys each leave ≥ 1
  authorized key, but together could empty the set and lock a party out.
- `Ledger.LiftFinalize` (single-finalize) and `LiftVoid.NotFinalized` — a lift edge must not both finalize
  and void.
- `Ledger.InvoiceLink` (single-answer) — one invoice answered by exactly one chit.

The schema's own NOTEs flag each of these with "confirm the isolation model when a runner exists." This
doc records the answer.

## How the count/existence constraints stay safe

A Quereus `CHECK` containing a subquery is **deferred to commit**. Executed there against the
transaction-start snapshot, two concurrent transactions could *each* pass locally. Safety does **not** come
from re-judging the predicate against the latest state. It comes from **optimistic-concurrency
read-dependency validation**:

1. The deferred CHECK's subquery reads — including the **structural (B-tree) blocks** it scanned, which is
   what catches a phantom insert into a scanned range — are captured as read dependencies.
2. At commit, the transaction is **rejected if any block it read has advanced**.
3. The loser **retries**; on retry it sees the winner's write, and its constraint now correctly fails.

Net outcome: two transactions that each passed against a stale snapshot **cannot both commit**.

**Worked example — `NotLastKey`.** Device A revokes B's key; device B revokes A's key. The two revocations
target *different* keys, so they do **not** collide on the `(Sid, PublicKey)` primary key — this is exactly
why the schema worried. But both `count(*) from AuthorizedKey` subqueries read the revocation collection's
blocks. The second to reach consensus is a stale read, is rejected, retries, and then correctly sees the
count drop to 0 → rejected. **The party is not locked out.** The schema author's proposed fallback
("serialize revocations per Sid") is unnecessary under this model — the shared *read dependency*, not a
shared PK, is what serializes them.

## This realizes the "any action, any time" goal

The intent is that either party, on either side, may take any allowed action at any time and the tally
state responds with a logical transition that preserves everyone's rights. The OCC model delivers exactly
that: actions are attempted freely; the ones whose preconditions went stale are **rejected-and-retried**
into a correct re-evaluation, rather than corrupting state or deadlocking. The safety comes from the
transaction *log* behaving like a grow-only set with deterministic replay — **not** from the *state* being
a CRDT.

## Two load-bearing assumptions (the platform asks)

The above holds **iff** both are true. They are dependencies on the Sereus/Optimystic/Quereus stack, not
things Taleus can enforce in its schema. Full detail (with citations) goes to the platform team; the
one-liners live in [STATUS.md](STATUS.md).

1. **Tally strands bind the synchronous Optimystic network transactor — never the CRDT/KV path.** The stack
   also has a column-level last-write-wins CRDT replication path that **bypasses the SQL layer and does not
   fire constraints at all**. A tally strand served through *that* path would silently void every
   signature, credit, and balance gate. The Taleus schema declares no transactor (the runner chooses the
   backing), so this must be pinned deliberately.
2. **Read-dependency validation is live on the consensus commit path.** The stale-read rejection is what
   makes §"How the … constraints stay safe" work. It is documented and implemented, but wiring it fully
   into cluster consensus is flagged as partly future work. **Acceptance test:** two nodes fire the
   concurrent double-revocation; assert exactly one commits.

A third, milder assumption: the model is **snapshot isolation with write-skew prevention** ("equivalent to
serializable for most workloads"), not literal serializability. For this grow-only-set-shaped schema that
is more than enough — only the handful of constraints above ever need it.

## Related liveness notes

- **Partition (CP).** A cadre in the minority partition cannot commit, so time-sensitive actions —
  notably **key revocation** — are delayed until it heals, widening the stolen-key race window (see
  [tally-lifecycle.md](tally-lifecycle.md) C1). Not a safety hole; a bounded liveness cost.
- **Per-node latch-deadlock bug** on concurrent same-block writes (Optimystic internals): a local liveness
  bug, not an isolation-correctness issue. Tracked in [STATUS.md](STATUS.md).

## Open questions

- Empirically confirm assumption 2 (the double-revocation test) once a runner exists.
- Pin assumption 1 in the runner/wiring layer with a guard against a tally schema ever mounting on the
  CRDT/KV path.
