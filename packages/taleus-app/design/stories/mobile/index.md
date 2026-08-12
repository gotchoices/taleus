# Stories Index (mobile)

The set of stories we intend to write, in reading order, and where each came from. Not a story itself.

Background for all of them: [theory.md](theory.md). Progress per story is tracked in
[STATUS.md](STATUS.md). Files excluded from the index itself: `AGENTS.md`, `STATUS.md`, `theory.md`.

Numbering leaves gaps so stories can be inserted without renumbering. A stub file exists for every
planned story; it states the topic and what it must not lose from MyCHIPs.

## Grouping

- **01–07 Tally lifecycle** — negotiation through close
- **10–13 Identity** — who I am, what I disclose, my keys and devices
- **20–25 Trading** — direct chits between two partners, and getting the record out
- **30–31 Network** — lifts, and the settings that make them possible
- **40–43 Position and preferences**
- **50–51 Recovery and change**

## Provenance

Derived from the MyCHIPs app (`mc/mychips/client/chark`), whose functionality (but not specific UX) is the baseline we should not regress from: Tally / Request / Scan / Invite / Settings tabs; TallyRequest, TallyReport,
OpenTallyView, TallyPreview, TallyContract, TallyCertificate, TradingVariables, ChitHistory,
ChitDetail, PendingChits, PaymentDetail, RequestDetail, Activity, Invite (templates, limits,
comments), ShareTally, Pay, Receive/RequestShare, Profile (bio, address, avatar, certificate
selection), KeyManagement, Setting (currency, language), UpdateCUID, Scanner.

Also from `mc/mychips/doc/use-mobile.md`: the **Visual Balance Sheet** goal — the app should teach
net worth and the nature of value, not merely list transactions. That intent drives story 40.

## Taleus additions (no MyCHIPs precedent)

- **25 My records in my books** — accounting integration, with Bonum on the same platform as the
  case worth designing for
- **13 My devices** — a party is a cadre of devices, not one key on one phone.  There will likely be a cadre management screen that is just like other Sereus apps (see chat, health, etc)
- **41 My exchange rates** — multiple units of account require the party's own quotes
- **50 Recovery** — the counterparty re-key ceremony has no MyCHIPs analog

## Deliberate deferrals

- Automated/bot signing of offers (MyCHIPs anticipates it for vendors at scale)
- Multi-party or group tallies — a tally is two parties, by design
