---
provides: ["screen:ExchangeRates"]
mocks: [rates]
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
  - design/stories/mobile/41-my-exchange-rates.md
  - design/stories/mobile/40-my-position.md
  - design/generated/mobile/screens/ExchangeRates.md
depHashes: {}
---

# Consolidation: ExchangeRates

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/ExchangeRates.tsx` | The screen |
| `apps/mobile/src/data/rates.ts` | `readRates`, `setRate`, `clearRate`, `isStale` |
| `mock/data/rates.{happy,error}.json` | CHIP against a source; a stale flat rate for hours |

Two dead ends closed. `Settings` path B told a party their display unit had no rate and described
where rates live, because no screen existed; it now offers the way there, which is what the story
asked for. `Position`'s estimate names what it excluded and can now be acted on.

## Decisions

- **Half the screen is what a rate *means*.** Story 41 is not mainly about a number. A rate is the
  price value actually converts at through this party, standing until they change it, against people
  who may be watching that market far more closely. So what it enables, what it exposes them to, and
  how to limit it are on the screen *alongside* how to set it — never after, and never only in a
  confirmation.
- **Both directions, and the estimate takes the worse one.** `accept` and `part` are separate fields
  and the party is asked about both. The difference is named as their own reluctance rather than a
  fee. One set of rates serves trading and their own figures; there is deliberately no display rate
  to keep in step.
- **Widely traded and circle-only are properties of the unit, not sermons.** `widelyTraded` raises
  path G's warning; `circleOnly` says path F's opposite — a unit one pair or one circle uses is the
  safe case, and the screen says so rather than repeating a caution that does not apply.
- **Valuing and permitting movement are separate answers.** Path D. The editor asks them separately,
  and the screen says permitting movement is a signed permission living with trading settings.
- **What was signed is the instruction.** Following a source keeps `signed` where it was while
  `updated` moves, and the card says which is which — story 41 step 9's whole point.
- **Not pricing something is offered as a limit, not a failure.** "Stop pricing it" sits beside
  "Change it", because path G names it as one of the three ways to limit exposure.
- **A rate is written plainly, not through `Amount`.** It is a ratio between two units, and giving it
  a unit it does not have would be a lie in the app's own notation.
- **Three fixtures moved together.** Pricing CHIP here means `settings.happy.json` must call it
  priced and `position.happy.json` must stop excluding it. Its holdings are zero, so no figure
  changed — only what the estimate says it left out.

## Not built here

The ceiling on how much may accumulate this way, and the movement permission itself — both story 31,
deferred until the engine settles pricing behaviour. The screen names where they live rather than
offering a control that does nothing. Choosing a source from a list: the fixture carries one and the
editor keeps it; a catalogue of sources is an engine question, and the story's requirement is that
the party chooses rather than that the app offers many.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 130 tests in 15 suites; `npm run lint` no errors.
- Fourteen tests in `__tests__/rates.test.tsx`.
- Captured on `emulator-5566`.
