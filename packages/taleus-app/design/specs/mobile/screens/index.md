# Screens Plan

Screens for the **mobile** target, with the stories each one serves.

A screen does **not** need a spec file. Stories are the source; a consolidation is built from them
and the screen from that. A spec appears only where a human disagrees with what an agent would
otherwise infer, and then it contains the disagreement and nothing else. Most rows here have no spec
and should not acquire one.

## Screens

| Screen Name | Route | Spec File | Stories | Variants | Status |
|-------------|-------|-----------|---------|----------|--------|
| Welcome | Welcome | — | 10 | first-run | generated |
| Choose name | ChooseName | — | 10, 11 | naming | generated |
| Tally list | TallyList | tally-list.md | 06, 04 | happy, empty, error | generated |
| Tally view | TallyView | tally-view.md | 04, 07 | happy, error | generated |
| Tally history | TallyHistory | — | 24 | happy, empty, error | generated |
| Entry detail | EntryDetail | — | 24 | happy, error | generated |
| Tally terms | TallyTerms | — | 07, 03 | happy, error | generated |
| Trading settings | TradingSettings | — | 31 | happy, empty | draft |
| Close tally | CloseTally | — | 05 | happy, closing | generated |
| Create invitation | CreateInvitation | — | 01 | happy, empty | generated |
| Review invitation | ReviewInvitation | — | 02 | happy, expired | generated |
| Review offer | ReviewOffer | — | 03, 02 | happy, empty, superseded | generated |
| Standing invitation | StandingInvitation | — | 01, 10, 11, 21 | happy, empty | generated |
| Attention | Attention | — | 23 | happy, empty, error | generated |
| Attention history | AttentionHistory | — | 23 | happy, empty | generated |
| Pay chooser | PayChooser | — | 20, 21, 30 | happy | draft |
| Pay a partner | PayPartner | — | 20 | happy, error | generated |
| Pay through the network | PayThroughNetwork | — | 30 | happy, empty, error | draft |
| Create request | CreateRequest | — | 21 | happy | generated |
| Request view | RequestView | — | 21, 22 | happy | generated |
| Scan | Scan | — | 02, 21, 30 | happy, error | draft |
| Position | Position | — | 40 | happy, empty, error | generated |
| Exchange rates | ExchangeRates | — | 41 | happy, error | generated |
| Settings | Settings | — | 42 | happy | generated |
| Profile | Profile | — | 11 | happy, empty, error | generated |
| Disclosure view | DisclosureView | — | 11 | happy, empty | generated |
| Devices | Devices | — | 13, 12 | happy, empty | generated |
| Cadre | Cadre | — | 14, 51 | happy, empty | generated |
| Recovery setup | RecoverySetup | — | 12, 50 | happy, error | draft |
| Notifications | Notifications | — | 43 | happy, error | generated |

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
