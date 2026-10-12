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
  - design/stories/mobile/08-publishers-i-trust.md
  - design/generated/mobile/screens/Agreement.md
  - apps/mobile/src/data/inviteLink.ts
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

## Contracts (2026-10-11)

- **The agreements offered are the trusted publishers' tally contracts** (story 01 step 6): the
  model lists each trusted publisher's `tally-contracts` collection plus agreements trusted alone. The
  chosen one shows `PublisherNote` and opens `Agreement`. An empty list says the publishers could not
  be reached rather than showing nothing.
- **An agreement from elsewhere** (story 01 path F): a link (what an agreement's code carries) is
  looked up with `importAgreement`, which fetches and verifies it but trusts nothing. The result shows
  `PublisherNote`; the party can use this agreement (trusting it alone), trust its publisher (offered
  only when the publisher confirmed it), or leave it. Scanning the code itself is `Scan`'s, still a
  draft; pasting the link is the same path.
- **An unreadable agreement cannot be offered.** `createInvitation` refuses it; the message shows in
  place.

## Sharing (2026-10-12)

| File | Role |
|------|------|
| `apps/mobile/src/data/inviteLink.ts` | The invitation link: build, read, and route the `#` form |
| `apps/mobile/src/navigation/linking.ts` | Rewrites the `#` form to the path `ReviewInvitation` is routed by |
| `web/invite.html` | Reads the token from the fragment when the app is not installed |

- **Making says it is making.** Creating an invitation founds the tally's strand: a minute or more on
  a slow phone. The button reads "Making the invitation…" and a note says why.
- **Handed over two ways, one link** (story 01 step 8, path D): a QR code of the link for someone
  present, which their phone's own camera opens (the app if installed, `web/invite.html` if not), and
  the platform share sheet for someone apart. The link stays selectable; the share sheet offers Copy,
  so no clipboard module (and no native rebuild) was added. `react-native-qrcode-svg` draws through
  the `react-native-svg` the app already had; it is mocked in Jest, which has no asset registry.
- **The code is dark on white whatever the theme**, with a quiet zone, at error correction L: the
  link is about 1,150 characters, so density matters more than damage tolerance on a screen.
- **An outstanding invitation can be shared again** from the list; an expired, withdrawn or taken-up
  one shows its state instead.
- **The note says who it is for** (story 01 step 1, revised): "Who it's for (only you see this)",
  and that whoever accepts becomes the other party whatever it says.
- **Smaller tokens**, from the model and core: the strand's invitation is plain JSON inside the
  envelope (not a second base64), carries only WebSocket addresses, and the seat's secret is base64url.
  From about 1,600 characters to about 1,150 with an agreement CID now included.

`Scan` (scanning inside the app) is still a draft; the camera app covers the in-person case.
