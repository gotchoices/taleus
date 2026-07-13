----
description: Let each tally be kept in any unit of account (not just CHIPs), and define how exchange rates are set and applied so payments and lifts can cross between units.
files: docs/architecture.md, schema/draft1.sql
----
Unlike MyCHIPs, a Taleus tally's contract chooses its denomination — CHIPs, a national currency, hours of labor, anything the parties agree on. Architecture.md § Denominations and Exchange states the model; this ticket designs the mechanics.

Requirements:
- **Contract argument**: denomination identifier + scale (what one `Ledger.Units` integer means, e.g. milliCHIP, cent) travels as a contract argument (see `feat-schema-credit-terms` for the argument mechanism) and is fixed for the tally's life.
- **Denomination registry**: how denominations are identified so both parties and routing agents agree on meaning — a well-known code list (ISO 4217 + CHIP + open-ended custom units?), collision handling for custom units.
- **Exchange rates**: a party holding tallies in more than one denomination quotes rates between them as private trading policy (portfolio state — see `feat-portfolio-state`; unlike trading variables, which are published per tally in the strand). Design the quote structure: pair, ratio, spread/margin, validity window, and how the lift agent applies it during discovery and commit.
- **Rate integrity in lifts**: the committed lift terms bind each edge's units in that edge's own denomination, so no participant bears rate movement after signing. The discovery phase must accumulate the conversion product end-to-end and present the originator the exact source-denomination cost of delivering the target amount.
- **Payments**: specified in the recipient's denomination; define rounding rules along a conversion chain (integer smallest-units at every edge — who absorbs the remainder).
- Degenerate case must stay clean: single-denomination lift = all rates 1 = MyCHIPs behavior.

Expected outcome: denomination + rate design doc section(s) and schema/portfolio structures; prerequisite understanding for denomination-aware routing in `feat-chipnet-integration`.
