description: When a lift node receives a transaction record from a neighbour and has nothing new to add, it sends the same record straight back to that neighbour instead of staying quiet, which the original ChipNet code avoided. Harmless but wasteful; restore the suppression.
files: packages/tallynet/src/consensus/participant.ts, packages/tallynet/src/consensus/store.ts, packages/tallynet/src/consensus/participant.test.ts, packages/tallynet/docs/chipnet-review.md
difficulty: easy
----

A real (minor) regression found by the ChipNet regression check (`packages/tallynet/docs/chipnet-review.md` § Regression check, Consensus table row "Inbound peer-record save"). Not a correctness bug — the union merge is idempotent, so an echoed record changes no outcome — but a lost convergence/bandwidth optimisation that ChipNet had and TallyNet dropped with no stated reason.

## What ChipNet did

ChipNet's `TrxParticipant.update(record, fromAddress)` saved the record the peer just sent **before** doing anything else: `../chipnet/src/transaction/participant.ts:34`

```
if (fromAddress) {
    await this.state.savePeerRecord(fromAddress, record);
}
```

That primes the push skip-test. When this node then pushes to reachable peers, the skip-test (`pushModified` → `getPeerRecord(peer, tx)` equal? skip) finds the sender's last-known copy already equal to what we would send, so **we do not echo the record straight back to the peer we just got it from**. (ChipNet even flags a staleness subtlety in a `TODO` at `participant.ts:33` — the saved copy might be older than what we just sent it — but the suppression itself is deliberate.)

## What TallyNet does

`TrxParticipant.update(record, fromAddress)` (`packages/tallynet/src/consensus/participant.ts:144`) uses `fromAddress` **only** for the `record-received` trace event (`:225`). `savePeerRecord` is called **only after a successful outbound push** (`push`, `:627`). So on first receipt from peer X, the skip-test in `push` (`getPeerRecord(tx, X.key)`, `:618-620`) has no entry for X, and a node whose state does not change (a pure relay, or any node that has already signed) **pushes the record right back to X**. One redundant round-trip per receiving node per delivery.

## Fix

In `update`, when `fromAddress` is supplied, record the peer's copy as their last-known before `push` runs — mirroring ChipNet. The natural spot is in `validateAndMerge` (or right after it) in `packages/tallynet/src/consensus/participant.ts`: after the record is merged and saved, call `store.savePeerRecord(merged.transactionCode, fromAddress.key, snapshotRecord(merged))` so the subsequent `push` skip-test suppresses the echo.

Subtlety to preserve, not reintroduce a bug:
- Save the **merged** record (what we now hold), not the raw incoming one — otherwise the skip-test compares our push against a *subset* of what we know and still echoes. (ChipNet saved the raw incoming record, which is why its own `TODO:33` worries about staleness; saving the merged record is strictly better and avoids that worry.)
- The snapshot must be a frozen copy (the live `merged` keeps mutating as we advance state), exactly as `push` already snapshots before `savePeerRecord` (`:623-627`).
- This must not suppress a push the peer genuinely needs: if our state advances (we add a promise/commit) **after** this save, `merged`/the live record differs from the saved snapshot, so `push`'s content compare (`sameSignatureSets`) correctly re-pushes. Only an unchanged record is suppressed.

## Edge cases & interactions

- **Relay node** (not in topology): merges and pushes without signing — this is the main case that currently echoes. After the fix it must stay silent toward the sender but still forward to its *other* reachable peers.
- **Circular lift / 2-cycle on a tally link**: both ends push to each other every delivery. Saving the sender's copy must not deadlock diffusion — the record still reaches the sender via its *own* advancing state (content differs ⇒ re-push). Assert the lift still settles everywhere.
- **Drop/sleeping links**: suppression keys off our stored peer-record, independent of delivery conditions; a dropped push never saved a peer-record, so nothing changes there.
- **Restart**: peer-records are durable; after a restart with no stored peer-record, the first receipt re-primes it (same as today, one echo then quiet).
- Do **not** regress the existing "push suppressed when peer copy equals" test; add a test asserting a relay that receives an unchanged record issues **no** `updatePeer` back to the sender (assert via the harness's `deliveryErrors`/a counting `updatePeer`, or a trace assertion that no `record-pushed` targets the sender).

## TODO

- In `packages/tallynet/src/consensus/participant.ts`, save the sender's last-known peer-record (merged snapshot) when `fromAddress` is present, before `push`.
- Add a regression test in `packages/tallynet/src/consensus/participant.test.ts` (or `testing/consensus.test.ts`): a relay receiving an unchanged record pushes onward but not back to the sender; a sender whose state then advances still receives the updated record.
- Confirm `testing/consensus.test.ts` atomic-settlement scenarios (linear, circular, diamond, sleeping, referee sets) still settle everywhere and that message counts drop (optional assertion).
- Drop the "regression" note for this row from `chipnet-review.md` once landed (leave the row, mark it kept).
