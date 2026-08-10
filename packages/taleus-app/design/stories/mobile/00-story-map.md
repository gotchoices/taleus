# Story map (mobile)

The set of stories we intend to write, and where each came from. Not a story itself.

Background for all of them: [theory.md](theory.md).

Numbering leaves gaps so stories can be inserted without renumbering. A stub file exists for every
planned story; it states the topic and what it must not lose from MyCHIPs.

## Status

| # | Story | State |
|---|-------|-------|
| 01 | Invite a partner | drafted |
| 02 | Respond to an invitation | drafted |
| 03 | Negotiate terms | drafted |
| 04 | First look at an open tally | drafted |
| 05 | Close a tally | stub |
| 06 | Find a tally | stub |
| 07 | Review the agreement | stub |
| 10 | First run | stub |
| 11 | My profile and what I disclose | stub |
| 12 | Keys and backup | stub |
| 13 | My devices | stub |
| 20 | Pay a partner | stub |
| 21 | Ask to be paid | stub |
| 22 | Respond to a request | stub |
| 23 | What needs my attention | stub |
| 24 | Tally history | stub |
| 30 | Pay someone I'm not connected to | stub |
| 31 | Trading variables | stub |
| 40 | My position | stub |
| 41 | My exchange rates | stub |
| 42 | Settings | stub |
| 43 | Notifications | stub |
| 50 | Recover after losing a device | stub |
| 51 | Change my address | stub |

## Grouping

- **01–07 Tally lifecycle** — negotiation through close
- **10–13 Identity** — who I am, what I disclose, my keys and devices
- **20–24 Trading** — direct chits between two partners
- **30–31 Network** — lifts, and the settings that make them possible
- **40–43 Position and preferences**
- **50–51 Recovery and change**

## Provenance

Derived from the MyCHIPs app (`mc/mychips/client/chark`), whose screens are the baseline we should
not regress from: Tally / Request / Scan / Invite / Settings tabs; TallyRequest, TallyReport,
OpenTallyView, TallyPreview, TallyContract, TallyCertificate, TradingVariables, ChitHistory,
ChitDetail, PendingChits, PaymentDetail, RequestDetail, Activity, Invite (templates, limits,
comments), ShareTally, Pay, Receive/RequestShare, Profile (bio, address, avatar, certificate
selection), KeyManagement, Setting (currency, language), UpdateCUID, Scanner.

Also from `mc/mychips/doc/use-mobile.md`: the **Visual Balance Sheet** goal — the app should teach
net worth and the nature of value, not merely list transactions. That intent drives story 40.

## Taleus additions (no MyCHIPs precedent)

- **13 My devices** — a party is a cadre of devices, not one key on one phone
- **41 My exchange rates** — multiple units of account require the party's own quotes
- **50 Recovery** — the counterparty re-key ceremony has no MyCHIPs analog

## Deliberate deferrals

- Automated/bot signing of offers (MyCHIPs anticipates it for vendors at scale)
- Multi-party or group tallies — a tally is two parties, by design
