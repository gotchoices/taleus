# Amounts, and how they are written

Every Taleus app writes amounts the same way. This is not a visual style — it is how a Taleus amount
is *read correctly*, and a target that renders it differently misrepresents the data.

## Why not a decimal point

A Taleus amount is a whole number of a unit's smallest part plus the unit and its scale
([interfaces.md](interfaces.md)). It is not a decimal, and writing it as one invites two errors.

The first is ambiguity. `1.000 CHIP` is one CHIP to an American and a thousand CHIPs to a German,
because the two conventions swap the roles of `.` and `,`. No choice of separator is safe: the same
glyph means opposite things to different readers, and a party who reads it wrong is wrong about money.

The second is category. A decimal point suggests a continuous quantity that could be divided further
and rounded. Taleus amounts cannot: a millichip is the smallest thing that exists, and 1.0005 CHIP is
not a value that a party can hold or a rounding error to absorb — it is not a number in this system.

MyCHIPs reached this conclusion and adopted the notation below. Taleus inherits it.

## The notation

An amount is written as **a whole number and a common fraction** — the fraction stacked beside it,
smaller, numerator on a short bar, denominator beneath. **Nothing separates whole from fraction** —
no point, no comma, no space.

**The denominator appears only when it is not a power of ten.** Where it is, the digit count already
states it — two digits over the bar can only mean hundredths — so it is left implied.

```
         50
  $  180 ──            a hundred eighty dollars and fifty cents

         250
  ⑧  1  ───            one CHIP and two hundred fifty millichips

          07
  DH  6  ──            six hours and seven minutes
          60

  WDG  6               six whole units; this unit has no fraction
```

Reading it as a common fraction is what makes the notation principled rather than a typographic
trick — `50` over `100`, with the denominator elided because the reader can infer it. And it is what
lets a sixty-part unit be written at all: `2` over `07` alone is ambiguous — two hours seven minutes,
or two and seven hundredths? — while `07/60` is not.

- **No separator, ever.** Size and position carry what a decimal point used to, and they mean the
  same thing in every locale.
- **The bar is drawn, not decorated.** A rule the width of the fraction. Never a text underline:
  underline rendering is unreliable across platforms and fonts, and it is the known defect in the
  MyCHIPs implementation.
- **The fraction is always shown** when the unit has one, including when it is zero (`$180` over
  `00`), so a column of figures aligns and no reader wonders whether digits were dropped.
- **A unit with no fraction gets none.** No bar, no zeros — `6 Dave-hours`.
- **Grouping stays, and stays local.** The whole part is grouped by the reader's locale, so a German
  sees `1.234.567` and an American `1,234,567`. That is safe now, precisely because no separator
  appears anywhere else in the figure.
- **The unit always leads**, before the sign and the figure, whatever the unit is. See below.
- **Sign sits outside**, before the whole figure, along with any estimate mark: `≈ −$42` over `50`.

## One number decides all of it

A unit declares a single **divisor**: how many of its smallest parts make one whole. Everything about
how the amount is written follows from that one number and the whole-number `units`.

| Unit | Smallest part | Divisor | Written as |
|------|---------------|---------|------------|
| `iso4217:USD` | cent | 100 | two digits, denominator implied |
| `CHIP` | millichip | 1000 | three digits, denominator implied |
| an hour of someone's time | minute | 60 | two digits over `60` |
| a unit counted whole | itself | 1 | no fraction at all |

```
whole      = floor(|units| / divisor)     sign kept aside, never derived from the quotient
numerator  = |units| mod divisor
width      = digits in (divisor − 1)      zero-padded to that width
denominator shown  ⟺  divisor is not a power of ten
```

Keeping the sign aside is not fussiness: taking it from the quotient is what produces a whole part of
"−0" for any amount between −1 and 0, which is the bug in the MyCHIPs implementation.

**One divisor is enough**, and it stays enough for units that do not divide by ten. The one thing it
cannot express is a *compound* subdivision — hours into minutes into seconds, or the old pound into
shillings and pence. Such a unit still renders correctly as a single fraction (`427/3600`), just not
as `2h 07m 07s`. If one ever appears, the divisor becomes a list; nothing here has to change first.

The engine is what says what a unit's divisor is — see [interfaces.md](interfaces.md) § Units.

## What must never happen

- **No floating point.** Quotient and remainder on `units`, as above. Dividing to a float and
  splitting the resulting string reintroduces the imprecision the whole-number model exists to avoid.
- **No rounding.** Units are exact. A figure that cannot be shown in full is a layout problem, not a
  rounding opportunity.
- **No bare number.** A figure without its unit means nothing on a party's mixed-unit list.

## Writing the unit: code and mark

Every unit has a **code** — always present, always safe to show. Some also have a **mark**, which is
shorter and more familiar. `USD` and `$` are the same unit written two ways.

| Unit | Code | Mark | Where they come from |
|------|------|------|----------------------|
| a standard currency (`iso4217:*`) | `USD` | `$` | the standard; the locale supplies the glyph, not its position |
| CHIP | `CHIP` | the chit mark | the app |
| anything else | what the parties agreed | optional, what the parties agreed | the tally |

**Which one a reader sees is their choice, not the tally's** — a display preference alongside
language and theme (story 42). The default is the mark where one exists, because `$180` is what
people read fluently; a party who prefers `USD 180`, as MyCHIPs shows it, sets it once and gets it
everywhere. Either way the unit is present, which is the rule that actually matters.

### Codes for units no country issues

ISO 4217 reserves codes beginning with **X** for things no country issues — `XAU` for gold, `XAG`
silver, `XDR` for the IMF's drawing rights. It is the standard's own escape hatch, and a Taleus-wide
unit belongs in it: an X-code is three letters like any other, aligns in a column, slots into
accounting systems and `Intl` without a special case, and cannot be mistaken for a mark.

Two limits keep it from being the general answer:

- **The namespace is small and already contested.** Three letters is 17,576 codes, ISO has assigned
  a handful, and the crypto world has informally claimed many more — `XCH` is Chia, `XMR` Monero,
  `XRP` Ripple, `XLM` Stellar. Picking one for CHIP means picking an unclaimed one, and it is a
  decision made once for all of Taleus, not per party.
- **Community units cannot use it.** If every group of friends can mint a unit of account, three
  letters runs out and collisions become certain — and a collision is the same failure as the `$`
  spoof: two unlike things wearing one name.

So a code is a **display name, never identity**. Identity stays the unit's identifier — `iso4217:USD`,
or the content id of a community unit's definition. Taleus-wide units get an X-code assigned once by
Taleus; community units get whatever short code the parties agreed, which is unverified and therefore
never stands alone.

**Open:** which X-code CHIP takes. `XCH` reads well but Chia has used it publicly since 2021.

### The unit goes first, always

A currency symbol's position is a locale convention — `$180` in English, `180 €` in French. Taleus
does not follow it. The unit leads every figure, before the sign, in every locale and for every kind
of unit.

The reason is what this app is: a party's list has dollars, CHIP, and somebody's hours in adjacent
rows, and no single unit is privileged ([rules.md](rules.md)). What a figure counts is not decoration
there — it is the first thing a reader needs, before how much. One position for every unit also means
a reader never has to work out whether a given row puts it before or after, which is exactly the
confusion the old arrangement produced: `$180` but `6 07/60 DH`.

The cost is real and worth stating: a French reader expects `€` after the number and will not get it.
That is a familiarity cost, not a correctness one — unlike the decimal separator, which was
genuinely ambiguous. The unit is always present and always in the same place, which is the property
that matters here.

### A tally's mark can never impersonate a standard one

A mark for a unit nobody standardises is a string a counterparty wrote. If it could be `$`, a list
would show `$100` for something that is not dollars, and the party reading it would be wrong about
money. Three rules close that off:

- A unit with a standard identifier takes its code and mark **from the standard**, never from the
  tally.
- A tally-supplied mark may not contain a Unicode currency symbol (category `Sc`) — that rejects
  `$`, `€`, `¥`, `₿` and `US$`, while leaving letters, digits, punctuation and combining overlays
  alone.
- A tally-supplied mark is short — a few grapheme clusters — and is never the *only* thing a party
  can see about the unit: its label is reachable wherever the amount is.

Within those bounds a custom mark is any short run of Unicode: `HD`, `H·D`, or a letter struck
through with a combining overlay (`H̵D̵`, U+0335). Overlays compose into one cluster and are
legitimate — but **whether one draws, and whether it reads, is the device's font's decision**. A mark
is set small; at that size a hairline overlay may be indistinguishable from an artifact even when it
renders. So an overlay is a preference, not a guarantee: a party choosing a mark should be shown it
at the size it will actually appear, not at the size they typed it. What overlays cannot do at all is
stack two of the same overlay in different positions, so a mark wanting two strokes has to be drawn
rather than typed — which is why the chit mark below is.

### The chit mark

CHIP has a mark of its own: two lobes crossed by two vertical rules — the same idea as `$` or `¥`, a
form with strokes through it, and the figure MyCHIPs already draws. It is a drawn glyph, sized from
the text it sits with and inheriting its colour, so it scales with the figure and needs no font on
the reader's device.

It was first attempted as an overstruck `8`, which is what the shape resembles and what Unicode could
nearly express. That failed for a reason worth recording: an `8` is a digit, and a digit immediately
beside a number is read as part of it — `⑧0` renders as eighty. A unit's mark has to be a form no
reader will mistake for a numeral, which rules out composing one from digits.

Where a custom code and mark live is the tally's business — the parties agreed the unit, so they
agreed what to call it. See [interfaces.md](interfaces.md) § Units.

## Reading it aloud, and writing it down

The notation is visual. Two other forms exist and are not optional:

- **Spoken.** Assistive technology hears the ordinary sentence — "one hundred eighty dollars and
  fifty cents", "two hours seven minutes" — never "one eighty fifty". A reader who cannot see the
  layout must not be handed an ambiguous string.
- **Plain.** Anything that leaves the app for another system — export, clipboard, a file for an
  accountant (story 24 path E) — uses the unambiguous machine form: the integer `units` with its
  unit identifier and scale, or a decimal string in a stated format. The display notation is for
  people looking at a screen and nowhere else.

## One implementation per target

Each target has exactly one module that turns an amount into its parts, and one widget that draws
them. No screen composes this itself, and no screen re-decides the sizes, the bar, or the spoken
form. Getting it wrong on one screen out of thirty is worse than not having the notation at all.

For the mobile target that is `src/util/amount.ts` and `src/components/Amount.tsx`
([components/index.md](../mobile/components/index.md)); sizes and colours come from
[global/ui.md](../mobile/global/ui.md), which owns appearance but not this notation.
