---
provides: ["screen:DisclosureView"]
mocks: [profile]
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
  - design/generated/mobile/foundation.md
  - design/stories/mobile/11-my-profile-and-disclosure.md
  - design/generated/mobile/screens/DisclosureView.md
depHashes: {}
---

# Consolidation: DisclosureView

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/DisclosureView.tsx` | The screen |

The adapter, fixtures and field vocabulary are `Profile`'s; this screen is the other half of the same
story and reads the same record.

## Decisions

- **Both directions on one screen.** What was told and what was heard are the same relationship, and
  a party asking "what do we know of each other" is asking one question.
- **What they sent is their claim.** Path E step 2: presented as their words about themselves, with
  Taleus explicitly not vouching for any of it.
- **Missing is missing, and nothing more.** Path E step 3. From this side a withheld address and one
  that was never recorded are indistinguishable, so the screen names the fields it does not have and
  says the difference does not reach here. It never uses the word "withheld".
- **Asking is the way past an absence.** Path E step 4, path B. One request per field, because each
  gets its own answer. The party can ask for something they do not hold themselves — asking is about
  what the other has said, not a trade.
- **A refusal is an answer.** Both directions. "I would rather not" sits beside "Send it" as an equal,
  and the note says what the counterparty will see rather than warning the party off it. Where the
  party holds nothing to send, that is stated plainly instead of the action failing silently.
- **Telling them more does not renegotiate anything.** Step 7: on the tally as it stands, no new
  tally and no change to the terms — and the counterparty is told, because this is not something to
  file silently into a record they may never reread.

## Not built here

The notification the counterparty receives (story 43). The screen states that they are told; what
that looks like on their device is that story's.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 102 tests in 13 suites; `npm run lint` no errors.
- Captured on `emulator-5566`.
