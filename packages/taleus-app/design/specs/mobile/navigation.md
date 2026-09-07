# Navigation Spec

Navigation structure, deep links, and route options for the **mobile** target. Derived from the
stories in `design/stories/mobile/`; each area below names the stories it serves.

## Sitemap

**Onboarding** (outside the tabs; shown until a party exists)
- `Welcome` — what Taleus is, before anything is asked (10)
- `ChooseName` — the one thing required up front (10, 11)

**TALLIES tab** (default)
- `TallyList` (root) — every tally, findable by partner, unit, activity, state (06)
  - `TallyView` — balance, terms in force, counterparty, what to do next (04)
    - `TallyHistory` — entries, running balance, outstanding requests alongside (24)
      - `EntryDetail` — one entry, what it answered, who signed it (24)
    - `TallyTerms` — terms in force, previous terms, the governing agreement (07)
    - `TradingSettings` — what may accumulate here and at what price (31)
    - `CloseTally` — request, withdraw, settle, or watch it age (05)
  - `CreateInvitation` — terms, unit, agreement, then share (01)
  - `ReviewInvitation` — the invitee's side; also the universal-link landing (02)
  - `ReviewOffer` — an offer waiting on this party; counter or accept (03)

**ATTENTION tab**
- `Attention` (root) — everything waiting on this party, across tallies (23)
  - items route into `ReviewOffer`, `RequestView`, `TallyView`
  - `AttentionHistory` — what has been through here and what became of it (23)

**PAY tab**
- `PayChooser` (root) — pay a partner, pay someone else, or ask to be paid
  - `PayPartner` — record value given on a tally (20)
  - `PayThroughNetwork` — pay a party with no tally, from their request (30)
  - `CreateRequest` — ask a partner for payment (21)
  - `RequestView` — one request: state, ageing, what was applied (21, 22)
  - `Scan` — open anything handed over in person: invitation, request, standing code

**POSITION tab**
- `Position` (root) — owed / owing per unit, estimate, spending power (40)
  - `ExchangeRates` — what units are worth to this party (41)

**SETTINGS tab**
- `Settings` (root) — language, display unit, appearance (42)
  - `Profile` — what this party holds about itself (11)
    - `DisclosureView` — what was disclosed to whom (11)
  - `Devices` — what can sign as this party (13, 12)
  - `Cadre` — machines holding this party's records (14, 51)
  - `RecoverySetup` — protection before value accumulates (12, 50)
  - `Notifications` — what interrupts, what merely informs (43)
  - `StandingInvitation` — a code others can take up (01 path C, 10 path E)

## Deep Links

- **Scheme**: `taleus://`
  - `taleus://screen/<Route>` — scenario capture and internal links
  - `taleus://screen/<Route>?variant=happy|empty|error` — mock variant selection
  - `taleus://screen/<Route>?locale=<tag>` — locale override for capture
- **Universal links**: `https://sereus.org/taleus/invite/<token>` → `ReviewInvitation`
  - The landing page is not claimed; only `/taleus/invite/*` opens the app
  - A token that has been redeemed, withdrawn, or is unrecognised lands on `ReviewInvitation` in its
    explained-failure state, never on a blank start
- A party arriving via a link with no identity yet completes onboarding and returns to the link's
  destination, not to the tab root (02 path A, 10 path A)

## Behavior

- The platform's back gesture and Android's hardware back go back within the app, and only leave
  Taleus from a tab root.
- Following a link to a screen the party is already on replaces it rather than stacking a second
  copy — opening the same notification twice must not build a pile.

## Route options

- `TallyList` is the launch route once a party exists; `Welcome` before that
- `ReviewInvitation`, `ReviewOffer`, `RequestView`, `PayThroughNetwork` are reachable from a
  notification and must stand alone — arriving at one directly is a first-class entry, not a
  deep-link special case (43)
- `Scan` is modal from anywhere in the PAY tab
- Destructive or binding routes (`CloseTally`, `PayPartner`, `ReviewOffer` accept, `TradingSettings`
  save) confirm in-screen; nothing binding is a side effect of navigating

## Notes

- Tab set is derived from what the stories say a party does, not from the MyCHIPs app; the closest
  precedent (`mc/mychips/client/chark`) used Tally / Request / Scan / Invite / Settings
- Attention is a tab rather than a badge because 23 makes it the thing a party opens the app for
- Nothing here implies visual treatment; `design/specs/mobile/global/ui.md` owns that
