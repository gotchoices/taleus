# User Story: Settings

## Story Overview

I want the app to speak my language, count in the unit I think in, and look how I want it to — and I
want to know which of those choices follow me to my other devices.

Context: Sam has a phone and a tablet. He speaks Spanish, thinks in dollars, and reads the app on a
bus in bright sun and in bed at night.

## Roles

Any party. Nothing here affects any counterparty or any tally.

## Sequence

1. Sam changes the app to Spanish. Everything he reads changes with it.
2. What does not change is anything a counterparty wrote: notes on entries, names, what people said
   things were for. Those stay as written, and it is clear they are quoted rather than untranslated.
3. He sets dollars as the unit he wants overall figures in. Individual tallies keep counting in what
   they were agreed in — that is not his to change ([03](03-negotiate-terms.md)).
4. He picks how the app looks: following his device, or always light, or always dark.
5. He can see which of these choices are his and follow him everywhere, and which belong to the
   device in his hand.
6. He picks up his tablet. It is in Spanish, showing dollars, without being told again.

### Alternative Path A: a language the app does not have
1.1. Sam's language is not among those available.
1.2. He is told what is available rather than left with a half-translated app, and — if there is a
     way for people to contribute translations — how to.

### Alternative Path B: a display unit he has no rates for
3.1. Sam picks a unit he has never priced against his holdings.
3.2. His overall figures cannot be estimated in it. He is told so, and offered the way to fix it.
     → [41](41-my-exchange-rates.md)

### Alternative Path C: settings that are not preferences
1.1. Among these, Sam finds things that look like settings but are not: what he lets partners owe
     him, how value may move through his tallies.
1.2. Those are agreements and signed permissions, and they live where they belong — with the tally
     ([03](03-negotiate-terms.md)) and with his trading settings ([31](31-trading-variables.md)) —
     not among choices about colors and language.

### Alternative Path D: starting over on a new device
5.1. Sam sets up a replacement phone.
5.2. What follows him arrives with him; what was the old device's is set afresh. He is not made to
     rebuild everything, nor surprised by a setting that stayed behind.

## Acceptance Criteria

- [ ] The party can choose the app's language from those available
- [ ] Counterparty-authored text is presented as quoted, never machine-altered
- [ ] The party can choose the unit their overall figures are expressed in
- [ ] Per-tally units are not presented as changeable here
- [ ] Choosing a display unit the party has no rates for is explained, with the way forward offered
- [ ] The party can choose the app's appearance, including following the device
- [ ] It is clear which choices follow the party and which belong to a single device
- [ ] Choices that follow the party are present on a newly added device without re-entry
- [ ] Agreements and signed permissions are not presented as preferences

## Variants
- happy: language, unit, and appearance set; carried to a second device
- empty: a party who changes nothing — defaults are sensible
- error: an unavailable language; a display unit with no rates behind it
