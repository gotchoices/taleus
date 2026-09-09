---
provides: ["screen:CreateInvitation"]
mocks: [invitations, agreements]
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
  - design/stories/mobile/01-invite-a-partner.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/CreateInvitation.md
  - mock/data/invitations.happy.json
  - mock/data/invitations.empty.json
  - mock/data/agreements.happy.json
depHashes: {}
---

# Consolidation: CreateInvitation

Built from story 01 with no screen spec.

## The decision that shaped the screen

**There is no recipient field.** Step 1 is explicit: the inviter is not asked who it is for. He is
setting out terms, and whoever accepts becomes the other party — their identity arrives only from
what *they* disclose when responding (step 10). The obvious form design, "invite [person]", would
have contradicted the model at the first field. The private note exists in its place, and the screen
says what it is: a memo to tell outstanding invitations apart, never a claim about who will respond.

## Other decisions

- **The two numbers are grouped under one statement**: these bind only the inviter, and the other
  party may extend nothing back (step 4). Putting that sentence under both fields rather than beside
  one of them is what makes it read as a property of the pair.
- **The unit warns before it is chosen, not after.** Step 5 has him think for a second before
  confirming, so "this cannot be changed once the tally exists" sits with the choice.
- **Nobody writes an agreement.** Only published ones are offered (path E). The list comes from a new
  `agreements` namespace; a `recommended` flag decides the default so the common case is one tap.
- **Validity is three durations, not a date picker.** Step 7 is "Sam is right there, so a day is
  plenty" — the answer is coarse by nature.

## What was built

`src/screens/CreateInvitation.tsx`, plus `src/data/invitations.ts` (`listInvitations`,
`listAgreements`, `createInvitation`) and three fixtures. The screen also introduces two form
patterns the app did not have: a labelled text field with a note, and `Choices` — one of a short
fixed set, as a radio group with proper accessibility roles.

`TallyList`'s empty state now routes its *Invite someone* button here. That button has existed since
the first slice and did nothing.

## Not built here

Sharing (step 8) — the token is shown and selectable, and the screen says sharing is not built. An OS
share sheet needs no engine, but it needs a decision about what is actually handed over.

Re-issuing an expired invitation from the same setup (path A), withdrawing one (path B), and the
standing invitation for a shop counter (path C) are `StandingInvitation`'s and are unsliced.

## Validation

`npx tsc --noEmit` clean; `npx jest` — seven tests over this arc, including that a created invitation
carries no counterparty field at all.
