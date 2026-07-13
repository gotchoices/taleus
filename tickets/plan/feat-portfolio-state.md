----
description: Decide where each user's private cross-tally state lives — their list of tallies, exchange rates, and in-flight lifts — and define its schema.
files: docs/architecture.md
----
The party-level portfolio replaces the MyCHIPs user database: the set of tallies a party holds, exchange-rate quotes between the party's denominations, pending lift bookkeeping, and app preferences. (Trading variables are *not* portfolio state — they are published per tally as signed `TradingVariable` rows in the tally strand, so the counterparty's lift agent can read them; see `schema/draft1.qsql`.) The portfolio is private to the party (never shared into a tally strand) but must be visible to all the party's own devices, including an always-on lift agent node.

Options to resolve:
- **Sereus control network** (`CadreControl` schema extension or companion tables): already replicated across the party's nodes; but control network is platform-owned schema — mixing app state in may be inappropriate.
- **Single-party strand**: a strand whose only member is this party, carrying a Taleus portfolio schema; cleanly separates app state, reuses strand replication/hibernation, natural `sAppId:taleus` filtering.
- Recommended default: single-party portfolio strand; validate against Sereus guidance for sApp-private state.

Also specify:
- Portfolio schema: tally registry (strand ID, role, denomination, counterparty certificate cache, state), rate quotes, lift journal.
- Consistency needs: the lift agent reads rate quotes at decision time; the phone edits them — plain Optimystic replication should suffice, but call out any read-your-writes expectations.
- Recovery: the portfolio is the map of the party's financial life — losing it must not lose tallies (each tally strand is independently recoverable via cadre membership; portfolio should be reconstructible or durably replicated).
