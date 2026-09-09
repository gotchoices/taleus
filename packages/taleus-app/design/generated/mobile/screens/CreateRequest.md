---
provides: ["screen:CreateRequest"]
mocks: [tally, requests]
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
  - design/stories/mobile/21-ask-to-be-paid.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/CreateRequest.md
  - mock/data/tally.happy.json
  - mock/data/requests.happy.json
depHashes: {}
---

# Consolidation: CreateRequest

Built from story 21 with no screen spec.

## The decision that shaped the screen

**There is no expiry field, and its absence is the point.** Step 3: a request is not set ticking. It
stands until the payer answers it or the requester takes it back — an unpaid bill does not stop
existing because a month went by. Every form of this kind invites a "valid until" control, and adding
one would have contradicted the story at the level of the data model, not just the wording. The
screen says why nothing is there.

The other half is said out loud too: a request obliges the other party to nothing by itself, and only
signed entries move the balance. That is the distinction `TallyHistory` already draws by keeping
requests beside the ledger rather than in it; this is where a party first meets it.

## Not built here

Withdrawing a request, watching it age, and seeing it answered in part are `RequestView` (stories 21
and 22), unsliced — so this screen can create a request but not follow one. A newcomer with no tally
gets an invitation rather than a request (path A), which is `CreateInvitation`'s and already built;
nothing here routes to it yet.

## Validation

`npx tsc --noEmit` clean; `npx jest` covers that a new request is `asked-by-me`, `waiting`, with
nothing applied, and that the screen carries both statements.
