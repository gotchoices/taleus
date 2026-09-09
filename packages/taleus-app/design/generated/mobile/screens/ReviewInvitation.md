---
provides: ["screen:ReviewInvitation"]
mocks: [invitation]
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
  - design/stories/mobile/02-respond-to-an-invitation.md
  - design/stories/mobile/11-my-profile-and-disclosure.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/ReviewInvitation.md
  - mock/data/invitation.happy.json
  - mock/data/invitation.expired.json
depHashes: {}
---

# Consolidation: ReviewInvitation

Built from story 02 with no screen spec.

## The decision that shaped the screen

**Order is the design.** What is being offered, and under which agreement, comes first — read while
the party has disclosed nothing (step 4). Only then is anything asked of them (steps 5 and 6). The
screen says "you have disclosed nothing so far" at exactly the point where that is still true.
Reversing it — collect details, then show terms — is the ordinary sign-up shape and would have them
paying before knowing the price.

## Other decisions

- **Needed and offered are visually distinct** (step 5). The inviter's `asks` carry `required`, so
  the screen shows it rather than inferring from field names. Accept is inert without a name and says
  why; nothing else blocks.
- **The limit defaults to zero** (step 6) with "zero is a normal answer, you can change it later"
  beside it. Defaulting to anything else would make the story's own answer look like a refusal.
- **Expiry is a screen, not an error** (path C): explained, with a way to ask for another. It has its
  own fixture variant for that reason.
- **A refusal states that it is final for this offer**, and that a fresh offer on new terms can
  follow (path B) — the story is careful that refusing ends the offer and not the relationship.
- **The inviter's name comes only from what the inviter disclosed.** `inviterName()` reads
  `inviter.disclosed.name` and falls back to the sid; nothing the invitee types can affect it.

## The universal link

`navigation.md` § Deep Links says `https://sereus.org/taleus/invite/<token>` lands here. The linking
config now carries both that alias and the `screen/ReviewInvitation/:token` form used for review, so
the same screen answers a real invitation and a scenario link.

## Not built here

Countering — changing the terms, which makes it the invitee's offer (path A) — is story 03 and
`ReviewOffer`. The screen says so rather than offering a button.

Reading the agreement in full (step 4) shows its title, publisher, language and a summary; the
document itself belongs to `TallyTerms`. Step 2, a person without the app being told what Taleus is,
is the web page in `taleus/web`, not this screen. Step 8 — the inviter told what was disclosed and
proposed — is `Attention`'s and the notification work.

## Validation

`npx tsc --noEmit` clean; `npx jest` covers terms-before-disclosure, needed vs offered, accept
requiring a name, zero credit accepted untouched, refusal finality, and the expired screen.
