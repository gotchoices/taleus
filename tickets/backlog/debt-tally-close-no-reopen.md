description: Once a tally's balance touches zero during close it becomes permanently closed with no way to reverse a mistaken final payment or reopen — decide whether that terminal state should be reversible by mutual consent.
prereq: feat-schema-tally-close
files: packages/taleus/schema/draft1.qsql
difficulty: medium
----
## Problem

`CloseState` (`packages/taleus/schema/draft1.qsql`) flips a closing tally to `'closed'` the
**instant** its settled `Ledger.Balance` reaches exactly zero and no pending lift is open.
Two schema facts make that state a hard, irreversible terminal:

- **No reopen/withdraw path.** `CloseRequest` is insert-only with no superseding row; the table's
  own `NOTE` says "no reopen/withdraw path". Once a `CloseRequest` is filed it cannot be rescinded.
- **The closing gate rejects every chit at zero balance.** `Ledger.ClosingReducesBalance` is written
  so that at prior balance `P = 0` both arms are false, so *every* direct chit is rejected. That is
  deliberate ("the Closed no-further-inserts rule"), but it also means no reversing chit can be
  written the moment the balance is zero.

Consequence: a **mistaken or uncompensated final payment that zeroes the tally cannot be reversed
on that tally.** The paying party has, on-ledger, no recourse — the tally is closed and frozen.

## Why this matters to the rights model

The tally's governing principle is that pledges are voluntary obligations enforceable under the
tally contract, which carries good-faith duties on both parties. Under that principle an
uncompensated pledge (I paid, you did not deliver) should be **reversible by the counterparty in
good faith** — and throughout `Closing` the schema *does* permit balance-reducing reversals. The
sharp edge is only at the boundary: the instant the balance hits zero, `'closed'` becomes terminal
and the on-ledger reversal right disappears. Today the only recourse is a *new* tally or an
off-ledger/legal dispute. That may be acceptable (the contract backstops it), but it is a
**deliberate loss of an on-ledger right** and should be a conscious decision, not an accident of
where the state view draws its boundary.

## What to decide

Pick the intended semantics, then implement (or explicitly accept and document):

- **Accept as-is.** `'closed'` is terminal; erroneous final payments are resolved by opening a
  fresh tally or out-of-band under the contract. Simplest; leans entirely on the contract backstop.
- **Bilateral reopen / close-withdrawal.** A new signed row (e.g. `CloseWithdrawal`, both parties
  co-signing) that supersedes an open `CloseRequest` and moves the tally back to `Open`. Safe and
  contract-aligned: two contracting parties can always mutually agree to amend/reopen. Needs a rule
  for what happens after the balance already reached zero (is `'closed'` reversible, or only
  `'closing'`?).
- **Settling window before terminal.** `'closed'` only becomes stable after the zero balance
  persists past a short signed settle window, leaving a bounded interval in which a reversing chit
  is still accepted. Adds a time dependency (see the volatility caveats already noted for
  `CurrentCreditLimit` / `InvoiceState`).

Interacts with `feat-lift-timeout-release` (a stuck pending lift also blocks reaching `'closed'`)
and with the general question of whether *any* signed tally row may be superseded/withdrawn.

No runner exists yet (design-phase schema); capture the decision and the constraint/table change.
