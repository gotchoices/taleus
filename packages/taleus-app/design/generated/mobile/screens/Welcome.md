---
provides: ["screen:Welcome"]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/10-first-run.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/Welcome.md
  - mock/data/party.happy.json
  - mock/data/party.empty.json
depHashes: {}
---

# Consolidation: Welcome

Built from story 10 with no screen spec. Nothing in the story needed overriding.

## What was built

| File | Role |
|------|------|
| `src/screens/Welcome.tsx` | the screen |
| `src/data/party.ts` | `readParty`, `createIdentity`, `setDisplayName` — the first adapter that writes |
| `src/session/index.tsx` | whether a party exists; the root state the navigator gates on |
| `mock/data/party.empty.json` | `party: null` — no identity yet |

## Decisions this slice had to make

- **The explanation comes before the identity.** Story 10 path D says a person can see what the app
  is for *without having created anything*. So Welcome reads with no identity in existence, and
  creating one is a consequence of choosing to continue. This is the constraint that decided the
  screen's shape; the obvious alternative — create silently on launch, then explain — fails it.
- **Two screens, not one.** Steps 2–4 are things the party is *told*; step 5 is the one thing they
  are *asked*. Welcome tells what Taleus is; `ChooseName` carries the rest of the telling and the
  single ask, so the ask is never competing with prose for attention.
- **Identity creation needs no network** (path C), so it has no pending or offline state. If it ever
  does, that is a change to the engine's contract, not to this screen.
- **`party: null` is a value, not an error.** The adapter returns `Result<Party | null>`; a missing
  identity is the normal state at this point and must not surface as a failure.

## Mock writes

The app has been read-only until now. `party.ts` holds a write in module memory: enough to walk the
flow and see the result, gone on restart. `resetParty()` exists so tests and scenario capture start
from a known state. Made durable by `feat-engine-tally-api`.

## Not built here

Story 10 path B — continuing as an existing identity on a replacement phone — is stories 13 and 50,
and both are unsliced. An affordance routing nowhere is worse than its absence, so there is none;
the string exists (`screens.welcome.have-identity`) for when there is somewhere to go.

Path E, publishing a standing invitation before holding any tally, is `StandingInvitation`.

## Validation

`npx tsc --noEmit` clean; `npx jest` 37 tests. Reviewable at
`taleus://screen/Welcome?variant=empty` — the `empty` party variant is what makes first run reachable
once an identity exists.
