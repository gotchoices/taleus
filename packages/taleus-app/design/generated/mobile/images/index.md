---
# Screenshot configuration — appId and scheme come from design/specs/project.md
appId: org.sereus.taleus
scheme: taleus

screenshots:
  - route: Welcome
    variant: first-run
    file: welcome-first-run.png
    deps:
      - apps/mobile/src/screens/Welcome.tsx
      - mock/data/party.first-run.json
  - route: ChooseName
    variant: naming
    file: choose-name.png
    deps:
      - apps/mobile/src/screens/ChooseName.tsx
      - mock/data/party.naming.json
  - route: CreateInvitation
    variant: happy
    file: create-invitation.png
    deps:
      - apps/mobile/src/screens/CreateInvitation.tsx
      - mock/data/agreements.happy.json
      - mock/data/invitations.happy.json
  - route: CreateInvitation
    variant: empty
    file: create-invitation-first.png
    deps:
      - apps/mobile/src/screens/CreateInvitation.tsx
      - mock/data/invitations.empty.json
  - route: ReviewInvitation/inv%3Ajan-bike-7c1
    variant: happy
    file: review-invitation.png
    deps:
      - apps/mobile/src/screens/ReviewInvitation.tsx
      - mock/data/invitation.happy.json
  - route: ReviewInvitation/inv%3Ajan-bike-7c1
    variant: expired
    file: review-invitation-expired.png
    deps:
      - apps/mobile/src/screens/ReviewInvitation.tsx
      - mock/data/invitation.expired.json
  - route: ReviewOffer/tally%3Arae-offer
    variant: happy
    file: review-offer.png
    deps:
      - apps/mobile/src/screens/ReviewOffer.tsx
      - mock/data/offer.happy.json
  - route: ReviewOffer/tally%3Arae-offer
    variant: superseded
    file: review-offer-superseded.png
    deps:
      - apps/mobile/src/screens/ReviewOffer.tsx
      - mock/data/offer.superseded.json
  - route: PayPartner/tally%3Amara-shop
    variant: happy
    file: pay-partner.png
    deps:
      - apps/mobile/src/screens/PayPartner.tsx
      - mock/data/tally.happy.json
  - route: CreateRequest/tally%3Asam-bike
    variant: happy
    file: create-request.png
    deps:
      - apps/mobile/src/screens/CreateRequest.tsx
      - mock/data/tally.happy.json
  - route: RequestView/request%3Amara-95
    variant: happy
    file: request-view.png
    deps:
      - apps/mobile/src/screens/RequestView.tsx
      - mock/data/requests.happy.json
  - route: RequestView/request%3Ajan-sam-60
    variant: happy
    file: request-view-mine.png
    deps:
      - apps/mobile/src/screens/RequestView.tsx
      - mock/data/requests.happy.json
  - route: CloseTally/tally%3Amara-shop
    variant: happy
    file: close-tally.png
    deps:
      - apps/mobile/src/screens/CloseTally.tsx
      - mock/data/tally.happy.json
  - route: CloseTally/tally%3Asam-bike
    variant: closing
    file: close-tally-closing.png
    deps:
      - apps/mobile/src/screens/CloseTally.tsx
      - mock/data/tally.closing.json
  - route: CloseTally/tally%3Adave-hours
    variant: closing
    file: close-tally-writeoff.png
    deps:
      - apps/mobile/src/screens/CloseTally.tsx
      - mock/data/tally.closing.json
  - route: TallyList
    variant: happy
    file: tally-list-happy.png
    deps:
      - apps/mobile/src/screens/TallyList.tsx
      - mock/data/tallies.happy.json
  - route: TallyList
    variant: empty
    file: tally-list-empty.png
    deps:
      - apps/mobile/src/screens/TallyList.tsx
      - mock/data/tallies.empty.json
  - route: TallyList
    variant: error
    file: tally-list-error.png
    deps:
      - apps/mobile/src/screens/TallyList.tsx
      - mock/data/tallies.error.json
  - route: TallyView/tally%3Asam-bike
    variant: happy
    file: tally-view-happy.png
    deps:
      - apps/mobile/src/screens/TallyView.tsx
      - mock/data/tally.happy.json
      - mock/data/requests.happy.json
  - route: TallyView/tally%3Apriya-new
    variant: happy
    file: tally-view-new.png
    deps:
      - apps/mobile/src/screens/TallyView.tsx
      - mock/data/tally.happy.json
  - route: TallyView/tally%3Asam-bike
    variant: error
    file: tally-view-unreachable.png
    deps:
      - apps/mobile/src/screens/TallyView.tsx
      - mock/data/tally.error.json
  - route: TallyView/tally%3Adave-hours
    variant: happy
    file: tally-view-hours.png
    deps:
      - apps/mobile/src/components/Amount.tsx
      - mock/data/tally.happy.json
  - route: TallyHistory/tally%3Asam-bike
    variant: happy
    file: tally-history-happy.png
    deps:
      - apps/mobile/src/screens/TallyHistory.tsx
      - mock/data/entries.happy.json
      - mock/data/requests.happy.json
  - route: Attention
    variant: happy
    file: attention-happy.png
    deps:
      - apps/mobile/src/screens/Attention.tsx
      - mock/data/attention.happy.json
  - route: Position
    variant: happy
    file: position-happy.png
    deps:
      - apps/mobile/src/screens/Position.tsx
      - mock/data/position.happy.json
  - route: Attention
    variant: empty
    file: attention-empty.png
    deps:
      - apps/mobile/src/screens/Attention.tsx
      - mock/data/attention.empty.json
  - route: Position
    variant: empty
    file: position-empty.png
    deps:
      - apps/mobile/src/screens/Position.tsx
      - mock/data/position.empty.json
  - route: TallyHistory/tally%3Apriya-new
    variant: happy
    file: tally-history-empty.png
    deps:
      - apps/mobile/src/screens/TallyHistory.tsx
      - mock/data/entries.happy.json
  - route: TallyView/tally%3Amara-shop
    variant: happy
    capture: false
    note: the other side of a balance — what this party owes
  - route: TallyView/tally%3Asupplier-parts
    variant: happy
    capture: false
    note: a tally that is closing
  - route: TallyHistory/tally%3Amara-shop
    variant: happy
    file: tally-history-answered.png
    deps:
      - apps/mobile/src/screens/TallyHistory.tsx
      - mock/data/entries.happy.json
      - mock/data/requests.happy.json
  - route: TallyList
    variant: happy
    locale: en
    capture: false
    note: locale override, for checking a translation
  - route: Settings
    variant: happy
    file: settings-happy.png
    deps:
      - apps/mobile/src/screens/Settings.tsx
      - apps/mobile/src/components/Options.tsx
      - mock/data/settings.happy.json
  - route: Profile
    variant: happy
    file: profile-happy.png
    deps:
      - apps/mobile/src/screens/Profile.tsx
      - apps/mobile/src/components/Options.tsx
      - mock/data/profile.happy.json
  - route: Profile
    variant: empty
    file: profile-empty.png
    deps:
      - apps/mobile/src/screens/Profile.tsx
      - apps/mobile/src/components/Options.tsx
      - mock/data/profile.empty.json
  - route: DisclosureView/tally%3Asupplier-parts
    variant: happy
    file: disclosure-supplier.png
    deps:
      - apps/mobile/src/screens/DisclosureView.tsx
      - apps/mobile/src/components/Options.tsx
      - mock/data/profile.happy.json
  - route: DisclosureView/tally%3Apriya-new
    variant: happy
    file: disclosure-missing.png
    deps:
      - apps/mobile/src/screens/DisclosureView.tsx
      - apps/mobile/src/components/Options.tsx
      - mock/data/profile.happy.json
  - route: DisclosureView/tally%3Adave-hours
    variant: happy
    capture: false
    note: a request this party made, answered with a refusal — the same card, other way round
  - route: DisclosureView/tally%3Arae-offer
    variant: happy
    capture: false
    note: disclosure chosen at formation, on a tally not yet countersigned
  - route: TallyTerms/tally%3Asam-bike
    variant: happy
    file: tally-terms.png
    deps:
      - apps/mobile/src/screens/TallyTerms.tsx
      - mock/data/terms.happy.json
  - route: TallyTerms/tally%3Asam-bike
    variant: error
    file: tally-terms-no-contract.png
    deps:
      - apps/mobile/src/screens/TallyTerms.tsx
      - mock/data/terms.error.json
  - route: TallyTerms/tally%3Amara-shop
    variant: happy
    capture: false
    note: a proposal nobody has answered — story 07 path A
  - route: TallyTerms/tally%3Apriya-new
    variant: happy
    capture: false
    note: a tally neither party has amended; the opening terms are the whole history
  - route: EntryDetail/tally%3Amara-shop/entry%3A0101
    variant: happy
    file: entry-detail.png
    deps:
      - apps/mobile/src/screens/EntryDetail.tsx
      - mock/data/entries.happy.json
  - route: EntryDetail/tally%3Asam-bike/entry%3A0007
    variant: error
    file: entry-detail-unsettled.png
    deps:
      - apps/mobile/src/screens/EntryDetail.tsx
      - mock/data/entries.error.json
  - route: EntryDetail/tally%3Asam-bike/entry%3A0005
    variant: happy
    capture: false
    note: an entry neither party typed — value routed through this tally
  - route: ExchangeRates
    variant: happy
    file: exchange-rates.png
    deps:
      - apps/mobile/src/screens/ExchangeRates.tsx
      - mock/data/rates.happy.json
      - mock/data/settings.happy.json
  - route: ExchangeRates
    variant: error
    file: exchange-rates-stale.png
    deps:
      - apps/mobile/src/screens/ExchangeRates.tsx
      - mock/data/rates.error.json
  - route: StandingInvitation
    variant: happy
    file: standing-published.png
    deps:
      - apps/mobile/src/screens/StandingInvitation.tsx
      - mock/data/standing.happy.json
  - route: StandingInvitation
    variant: empty
    file: standing-none.png
    deps:
      - apps/mobile/src/screens/StandingInvitation.tsx
      - mock/data/standing.empty.json
---

# Screenshots

Captured from a release build on `emulator-5560` (the AVD named in `.env.ports.local`), driven by
deep link — `taleus://screen/<Route>[/<id>][?variant=&locale=]`.

| Screen | Variant | Shows | Preview |
|--------|---------|-------|---------|
| Welcome | first run | what this is, before anything is asked | ![](welcome-first-run.png) |
| Choose name | naming | told it exists and lives here; asked one thing | ![](choose-name.png) |
| Create invitation | happy | terms, and nobody's name | ![](create-invitation.png) |
| Create invitation | first | the party's first-ever invitation | ![](create-invitation-first.png) |
| Review invitation | happy | the invitee's side, before disclosing | ![](review-invitation.png) |
| Review invitation | expired | explained, with a way forward | ![](review-invitation-expired.png) |
| Review offer | happy | what changed, then the terms | ![](review-offer.png) |
| Review offer | superseded | two signed; the later one governs | ![](review-offer-superseded.png) |
| Pay a partner | happy | value given, and its effect before signing | ![](pay-partner.png) |
| Create request | happy | asking, with no clock to set | ![](create-request.png) |
| Request view | asked of you | part-answered, and no clock | ![](request-view.png) |
| Request view | asked by you | yours to take back, not to answer | ![](request-view-mine.png) |
| Close tally | before | what closing costs, before asking | ![](close-tally.png) |
| Close tally | closing | awaiting settlement, not broken | ![](close-tally-closing.png) |
| Close tally | write-off | a remainder only its owner can give up | ![](close-tally-writeoff.png) |
| Tally list | happy | six tallies, one offered and figureless | ![](tally-list-happy.png) |
| Tally list | empty | nothing yet, and what to do about it | ![](tally-list-empty.png) |
| Tally view | happy | a tally with history, terms both ways | ![](tally-view-happy.png) |
| Tally view | new tally | story 04's actual scene: zero, explained | ![](tally-view-new.png) |
| Tally view | unreachable | story 04 path C: reads anyway, pending marked | ![](tally-view-unreachable.png) |
| Tally view | hours | a unit that divides by sixty — `6 07/60` | ![](tally-view-hours.png) |
| Tally history | happy | entries with the side of each balance | ![](tally-history-happy.png) |
| Tally history | answered | an entry recognisably tied to the request it answered | ![](tally-history-answered.png) |
| Attention | happy | what waits, how long, and reachable | ![](attention-happy.png) |
| Position | happy | per unit, then a marked estimate | ![](position-happy.png) |
| Settings | happy | grouped by what follows you and what does not | ![](settings-happy.png) |
| About me | happy | what I hold, and what each partner has | ![](profile-happy.png) |
| About me | empty | a name, told to one person | ![](profile-empty.png) |
| Disclosure | supplier | both directions, and a standing request | ![](disclosure-supplier.png) |
| Disclosure | missing | what is not here, without saying which kind | ![](disclosure-missing.png) |
| Terms | happy | in force, coming, proposed, and the contract | ![](tally-terms.png) |
| Terms | error | the contract unreachable; terms still readable | ![](tally-terms-no-contract.png) |
| Entry | happy | one entry, who signed it, what it answered | ![](entry-detail.png) |
| Entry | unsettled | movement that has not committed | ![](entry-detail-unsettled.png) |
| Rates | happy | a unit priced against a source, one left outside | ![](exchange-rates.png) |
| Rates | error | a source unreachable, and a rate left to go stale | ![](exchange-rates-stale.png) |
| Standing | happy | one code, its terms, and who took it up | ![](standing-published.png) |
| Standing | none | never published; what one is, before publishing | ![](standing-none.png) |

Notes:

- `appeus/scripts/build-images.sh` expects a debug build talking to Metro. These were captured from a
  release build instead, because the app bundles its JS and needs no dev server — simpler to
  reproduce and closer to what a reviewer would install.
- The app takes about five seconds from cold start to first paint on this AVD; a capture taken any
  sooner is a picture of the splash screen. An earlier round of these images was exactly that.
- A tally id contains a colon, which a URL path treats as a scheme separator — encode it as `%3A`
  (`taleus://screen/TallyView/tally%3Asam-bike`) or React Navigation's linking will not match.
- Cold start after a fresh install takes ~20s to first paint on this AVD; warm launches ~13s. Launch
  once to warm the app before a capture run, or the first image is a blank screen.
- **Capture does not restart the app**, and a variant change is ignored by a route that is already
  mounted: `?variant=error` on a warm `TallyList` re-renders the happy list. Force-stop between
  captures that change variant on the same route.
- First run is reachable with `?variant=first-run`, not `empty`: a variant applies to every namespace
  at once, and a party with no identity gates the whole app into onboarding — so `?variant=empty`
  aimed at one screen's empty state would show first run instead. The `ChooseName` captures are taken by walking the
  flow (`input tap`), not by deep link: onboarding screens have no linking config, by design.
- Captured after the React Native 0.87 upgrade, so the tab bar has icons and the headers are React
  Navigation's own.
