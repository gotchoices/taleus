---
provides: ["screen:CloseTally"]
mocks: [tally]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/domain/amounts.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/05-close-a-tally.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/CloseTally.md
  - mock/data/tally.happy.json
  - mock/data/tally.closing.json
  - mock/data/tally.error.json
depHashes: {}
---

# Consolidation: CloseTally

Built from story 05 (reviewed 2026-10-28) with no screen spec.

## Decisions

**Warned before the act** (step 2). Closing is the one thing a party can always do and the other
cannot refuse, and a request cannot be taken back. The screen says only that before offering the
request, with the reminder that the other party keeps everything owed; it does not enumerate the
rest of what closing implies.

**Closing gates lifts, not chits** (step 4). While closing, lifts may only move the balance toward
zero; that is the engine's rule (`ClosingReducesReserved` in the schema). A chit is its maker's own
promise and is still recorded either way. The model's `previewEntry` sets `growsClosing` when an
entry would move a closing tally's balance away from zero or past it (`awayFromZero`, shared by the
mock and the engine), and `PayPartner` shows that as a warning, not a wall. The screen's footnote
says lifts only move it toward zero now and that it closes for good at zero.

**Closed is final** (step 6). A closed tally refuses every entry (`closed`; the engine's
`NotClosed`). The mock keeps a fixture's Closed state even if a close is requested on it.

**Settled two ways** (step 5). The party owing settles through `PayPartner`; the party owed may hand
the balance back, a chit from the party owed that brings it to zero. Both are ordinary payments and
land in the history like any other.

**Waiting, not broken** (path C). A closing tally with a balance can stay that way for a year. The
screen says it is awaiting settlement, names any date the parties agreed, and, if that date has
passed, says so while stating that nothing has been added to the balance for it.

**Nothing is written off automatically, and the threshold is not ours.** A remainder is forgiven by a
deliberate act with an author, and only by the party it belongs to. Whether a remainder is trivial
enough to offer that for comes from the engine as `closing.offerWriteOff`. Declining leaves the tally
as it was and the offer does not return.

**Both requests, one close** (path F). A second request changes nothing; `requestClose` moves between
`me`/`them`/`both`. A request is not reversible (path E), so the screen offers no way back; carrying
on means a new tally, which may start before this one ends.

## Not built here

Path D (something in flight holding a close open) needs an unsettled routed entry, which no fixture
carries. Notifying the other party (step 3) is notification work. Story 05's *Open* section leaves
the reachability boundary undecided; this screen shows the unworkable case when the counterparty is
unreachable and does not predict when a write would succeed.

## Validation

`npx tsc --noEmit` clean; `yarn test`: the closing tests cover the irreversibility warning, a second
request, a closing tally recording an entry that grows its balance with `growsClosing` set, a closed
tally refusing (`closed`), awaiting settlement, the write-off offer, a missed date, and a remainder in
its unit; `paying.test.tsx` covers the warning on `PayPartner`.
