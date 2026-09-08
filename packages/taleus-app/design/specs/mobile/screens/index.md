# Screens Plan

Screens for the **mobile** target, with the stories each one serves. Spec files are written as a
screen is sliced, not up front.

## Screens

| Screen Name | Route | Spec File | Stories | Variants | Status |
|-------------|-------|-----------|---------|----------|--------|
| Welcome | Welcome | welcome.md | 10 | happy | draft |
| Choose name | ChooseName | choose-name.md | 10, 11 | happy, error | draft |
| Tally list | TallyList | tally-list.md | 06, 04 | happy, empty, error | generated |
| Tally view | TallyView | tally-view.md | 04, 07 | happy, error | generated |
| Tally history | TallyHistory | tally-history.md | 24 | happy, empty, error | generated |
| Entry detail | EntryDetail | entry-detail.md | 24 | happy | draft |
| Tally terms | TallyTerms | tally-terms.md | 07, 03 | happy, error | draft |
| Trading settings | TradingSettings | trading-settings.md | 31 | happy, empty | draft |
| Close tally | CloseTally | close-tally.md | 05 | happy, empty, error | draft |
| Create invitation | CreateInvitation | create-invitation.md | 01 | happy, error | draft |
| Review invitation | ReviewInvitation | review-invitation.md | 02 | happy, error | draft |
| Review offer | ReviewOffer | review-offer.md | 03, 02 | happy, error | draft |
| Standing invitation | StandingInvitation | standing-invitation.md | 01, 10, 21 | happy, empty | draft |
| Attention | Attention | attention.md | 23 | happy, empty, error | generated |
| Attention history | AttentionHistory | attention-history.md | 23 | happy, empty | draft |
| Pay chooser | PayChooser | pay-chooser.md | 20, 21, 30 | happy | draft |
| Pay a partner | PayPartner | pay-partner.md | 20 | happy, error | draft |
| Pay through the network | PayThroughNetwork | pay-through-network.md | 30 | happy, empty, error | draft |
| Create request | CreateRequest | create-request.md | 21 | happy, error | draft |
| Request view | RequestView | request-view.md | 21, 22 | happy, empty, error | draft |
| Scan | Scan | scan.md | 02, 21, 30 | happy, error | draft |
| Position | Position | position.md | 40 | happy, empty, error | generated |
| Exchange rates | ExchangeRates | exchange-rates.md | 41 | happy, empty | draft |
| Settings | Settings | settings.md | 42 | happy | draft |
| Profile | Profile | profile.md | 11 | happy, empty | draft |
| Disclosure view | DisclosureView | disclosure-view.md | 11 | happy, empty | draft |
| Devices | Devices | devices.md | 13, 12 | happy, error | draft |
| Cadre | Cadre | cadre.md | 14, 51 | happy, empty, error | draft |
| Recovery setup | RecoverySetup | recovery-setup.md | 12, 50 | happy, error | draft |
| Notifications | Notifications | notifications.md | 43 | happy | draft |

## Suggested slice order

Least exposed to design still in flight, and the arc a new party actually walks:

1. `TallyList` — the launch route; establishes the data layer and the empty state
2. `TallyView` — the thing a tally *is*
3. `Welcome`, `ChooseName` — first run
4. `CreateInvitation`, `ReviewInvitation`, `ReviewOffer` — a tally coming into existence
5. `Attention` — once there is something to wait on
6. `PayPartner`, `RequestView`, `CreateRequest` — value moving
7. `TallyHistory`, `TallyTerms`, `Position`
8. Everything else

Deferred until the engine settles the open questions: `PayThroughNetwork` (routes and capacity),
`TradingSettings` (pricing behaviour), `RecoverySetup` (off-device custody).

## Notes

- Routes are PascalCase and are the deep-link names: `taleus://screen/TallyList`
- Every screen listed here is reachable from `design/specs/mobile/navigation.md`
- Variants are the mock states a screen must handle, not a promise that all three are interesting;
  `happy` alone is listed where empty and error are not distinct experiences
