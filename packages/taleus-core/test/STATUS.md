# taleus-core — test inventory

Every test we can currently conceive for the core, whether written or not. This file is the
checklist the build works down; it is **not timeless** — a line goes away when it is covered and the
coverage is obvious from the suite itself.

Scope for now: **tally negotiation, tally management, and direct payments.** Network queries and
lifts are stubs; the lift module already has its own in-process suite (`src/lift/*.test.ts`) against
test doubles, and re-grounding that on the real schema comes after direct chits work.

## Roadmap — agreed sequencing

Where this is going, in order. Written to survive a context compaction: enough detail that the
next session can pick up without re-deriving the reasoning.

### Step 1 — direct chits, at the schema level *(complete)*

§§ 1–9 below are done: substrate, identity and keys, formation, negotiation, credit terms, direct
chits, invoices, close, reading. 240 tests over 20 suites. The credit gate is the heart of the
system and the row-level harness was the right tool for it — an API does not yet exist, and
building one over an unexercised gate would have baked in whatever was wrong with it. Five schema
defects and a handful of open questions came out of it; they are all in § 0.

### Step 2 — the Sereus seam

**Formation is settled**: [`docs/formation.md`](../../../docs/formation.md) states the model, and
`feat-formation-over-sereus-strand` is the work. Taleus's seating sits *inside* Sereus's formation
rather than duplicating it — `Stock.InvitationKey` **is** `Strand.Invite.Key`, one keypair at two
layers — the Taleus schema becomes `declare schema App { … }` beside `Strand` in one strand database,
and `TallyContract` is gated on the strand being sealed. Both mechanisms were verified against
Quereus rather than assumed: a sApp CHECK reads the `Strand` namespace, and `draft1.qsql` wraps with
no qualification changes.

**Identity is settled** too: `docs/identity.md`. A `Sid` is strand-local and anchored on the Sereus
`Member.Key`; `PartyKey` holds the keys that may sign as it. The two are *not* redundant, and the
reason is sharp — a sealed strand refuses `addMemberByManager`, so a party's Sereus membership key
can never be rotated for the life of a tally. Key rotation after a compromise is therefore Taleus's
job, and `PartyKeyAdoption` is the only recovery path.

**Atomic seating is settled**: Sereus's writers take `joinOpenTransaction` (default true), so
`consumeInvite` + `Foil` + genesis key commit as one act.

**The transactor question is answered**, and it was never as sharp as it read. The Sereus plugin's
`transactor` option is a closed union whose every member commits through Optimystic and therefore
fires SQL constraints; it defaults to the right one and throws on a typo. `quereus-sync` is a
different package the plugin does not depend on.

What is left in step 2 is adapter work, not research: implement `TallyStore` / `StoreProvider`
(`src/api/types.ts`) over `@serfab/quereus-plugin-sereus`. The plugin already wraps DDL as
`declare schema App { … } apply schema App;`, which is a chunk of
`feat-formation-over-sereus-strand` done upstream. One thing to try rather than assume: whether
invite redemption and Taleus seating commit as a single transaction (`begin`/`commit` exist on the
Optimystic vtable, so it looks answerable).

Parked upstream: `feat-multi-use-tally-invitation` — Sereus offers closed **XOR** multi-use, and a
vendor's printed QR needs both.

### Step 3 — the API surface *(done, over an in-memory store)*

`packages/taleus-core/API.md` is the argument; `src/api/` is the surface, the engine, and a
multi-party in-memory `StoreProvider`; `src/index.ts` exports it and nothing from `src/store/` or
`src/tally/`. `src/api/engine.test.ts` carries two parties from invitation to close — 18 tests,
none of them naming a table.

It was built ahead of step 2 on purpose, and that paid twice. The store seam
(`TallyStore` / `StoreProvider`) is the interface the Sereus adapter has to satisfy, and designing
the API is what determined its shape. And driving the schema from two *separate* parties, neither
holding the other's key, is what exposed the un-completable `TallyContract` in § 0 — which no
row-level test could have found.

Criterion 1 of `SPEC.md`. Not by extrapolating from the row-builders in `src/tally/` — that is how
table names leak through the seam. Two requirements that were already known, both honoured:

- **Async wherever anything can happen** (`SPEC.md` § 2). Sync only for pure computation over values
  in hand.
- **The error value must carry the engine's refusal reason**, not merely that something was refused.
  The row-level tests assert *which* constraint fired, and that has earned its keep twice: it caught
  a test passing on a SQL typo, and it caught `NotLastKey` being dead code. If the API flattens that
  into `{ kind: 'refused' }`, the suite gets weaker the moment it moves up.

### Step 4 — migrate the suite up, do not duplicate it

The dividing line is **not** "happy path versus refusal". Most refusals express fine through an API,
because the API must take keys and signers as parameters — a party holds several keys and chooses
which signs. The line is: **does the API compute the field under test?** If it does, the test has to
sit below it.

| Where | Roughly | Which |
|---|---|---|
| Stays below, always | ~27 | `src/store/*.test.ts` — host scalars, schema loading, determinism, spec rules, digest delegation. The core's internals; no API touches them |
| Moves up | ~36 | Most of `src/tally/*.test.ts`, refusals included. They improve: domain assertions instead of `select ... from AuthorizedKey` |
| Stays below | ~9 | Listed next. The reason a row-level layer exists at all |

The nine that stay are where the API computes the thing under attack, or the concept is row-shaped:

- `formation`: *refuses a genesis key that authorizes itself* (the API always signs genesis with the
  invitation key); *refuses a Cid that does not address its own founding fields* (the API computes
  the Cid); *cannot seat a party one row at a time* (documents why the API must be atomic)
- `keys`: *the fresh key must prove it is held* (forges a signature the API would never emit);
  *a batch that would empty the set* (batching is row-shaped); both `FINDING:` tests
- `negotiation`: the `FINDING:` counter-offer test (a PK collision on a second row)

These are not duplicates of anything. They answer *"what happens when a peer sends a row no honest
client would produce"* — which is why the schema validates rather than trusting the sender, and a
path an API test can never reach because the API **is** the honest path.

The two-replica harness (`src/store/test-harness.ts`) stays regardless: an API-level test still
wants "and the counterparty's engine accepted it too".

---

## Where tests live

- `src/**/*.test.ts` — co-located with the code, run by `yarn workspace taleus-core test`.
- `src/store/strand.ts` — opens the real `schema/*.qsql` in Quereus, in memory, with the host
  scalars registered. Everything below that touches persistence goes through it.
- `src/store/test-harness.ts` — the two-replica model: `Party`, `Tally.propose/refuses/sees/onlyOn`.
- `src/tally/test-harness.ts` — the *fixture* the ledger suites share: an open tally between Jan
  (stock, granting 50000) and Sam (foil, granting nothing), with `chit` / `invoice` / `decline` /
  `close` row builders bound to it. Both files match the `src/**/test-harness.ts` build exclude, so
  neither ships in `dist/`.

**Negotiation is always two parties.** `src/store/test-harness.ts` opens one replica per party, and an act
is *proposed* to both: each engine re-validates it against its own copy of the schema, and the row
stands only if both accept. That is the real safety model — the counterparty's engine is what stops a
forgery — and a test on one shared database would be testing a system nobody will run. A partial
acceptance raises `DisagreementError` rather than diverging silently.

Some things are honestly single-party: the host scalars, and a party's own key management before any
counterparty exists. Those open one replica.

What this does **not** model is Optimystic's ordering under concurrency — two replicas are applied in
sequence, not raced. Anything about two writers reaching the same row at once needs the real
transactor; marked *needs-transactor* below and tracked in `docs/STATUS.md` § Cross-repo.

Every `refuses(...)` assertion names the constraint it expects. A test that only asserts "something
failed" passes for the wrong reason sooner or later — one in this suite already did, failing on a
duplicate column in its own SQL while claiming to prove an authorization rule.

## Borrowed from MyCHIPs

`mc/mychips/test/auto` is the accumulated learning of the system this reboots — 5,543 lines. The
code does not transfer (PostgreSQL, `LISTEN`/`NOTIFY`, peer server processes, `json_core`), but the
**scenarios** are the expensive part and they do. Sources worth mining, in order of value:

| MyCHIPs file | Lines | What to take |
|---|---|---|
| `proto/tally.js` | 561 | The two-party signing dance, end to end |
| `proto/sch-tally.js` | 350 | What the schema must refuse |
| `proto/chit.js` | 377 | Chit exchange protocol |
| `proto/sch-chit.js` | 413 | Chit validity rules |
| `proto/chain.js` | 261 | Hash-chain integrity, gaps, repair |
| `unit/validtally.js` | 158 | Tally validation predicates |
| `unit/maketally.js` | 232 | Construction and signing |

---

## 0. Findings so far

Things the tests turned up that are design questions rather than test failures.

- **`Foil` is not a singleton.** `Stock` uses `primary key (/* 1 row */)`; `Foil` uses
  `primary key (Sid)`. A second responder is stopped only because they would be a third `Sid`
  (`TwoParties` on `PartyKey`). Sound today, indirect, and it reads as an oversight.
- **`DayNumber` and `Today()` are now separate scalars.** A gate calls `DayNumber(SomeColumn)` and is
  pure; a report calls `Today()` and is volatile. There is no spelling that lets a constraint read
  the clock by accident — which matters, because a CHECK that did would have replicas disagree.
- **The store's `Digest` delegates to `src/lift/digest.ts`.** The first draft carried a second
  encoding; that is precisely the divergence that file warns about, and it would have shown up as
  every signature failing to verify while looking like a permissions bug.
- **A `Sid` is not held to being anything — now with an answer.** Nothing enforces what a `Sid` is;
  a party may seat under any string. `docs/architecture.md` said it should be the hash of the
  genesis key, which assumed a portable identity. **That assumption is now reversed**
  (`docs/identity.md`): a `Sid` is **strand-local**, one person is deliberately not one identity,
  and the fix is to anchor it on the party's Sereus `Member.Key` — checkable, because a sApp CHECK
  can read the `Strand` namespace. Work is in `feat-formation-over-sereus-strand`.
- **`TallyContract` had never been insertable.** Four of its constraints referenced a bare
  `StockSid` / `FoilSid`, which exist only on `TallyCore` — `Column not found: StockSid` on the first
  insert. So the row that turns an offer into a tally could not be written at all. **Fixed**: spelled
  `(select StockSid from TallyCore)`, which is how every other table in the schema does the same
  lookup. Unambiguous repair of broken SQL, not a design change.
- **There is no counter-offer.** `TallyContractProposal` is `primary key (/* 1 row */)` with
  constraints `on insert, update` — one row, replaced in place. `docs/architecture.md` describes
  offers with identity, ordering and expiry, several outstanding at once, and the later-drafted one
  governing when two end up signed. None of that exists: a counter destroys the offer it answers,
  nothing expires, and no history survives. This is `feat-offer-lifecycle`, and it is the MyCHIPs
  signing dance the reboot left implicit. **Not fixed** — it is a design decision.
- **A host scalar used only inside a column CHECK is invisible until the first insert.**
  `ValidDenomination` was never registered and the schema-loads test passed regardless, because
  Quereus plans column CHECKs lazily. A test now reads the schema for every function it calls and
  asserts the host provides it.
- **Four columns documented "optional" are declared NOT NULL**: `CreditTerms.Args`,
  `Ledger.Reference`, `Ledger.Memo`, and `Invoice`'s pair. The schema's convention is an explicit
  `null` (six columns have it); these do not, so they cannot be omitted. The core passes empty text
  and the signature covers that — worth settling before anything signs in anger.
- **`Ledger.BalanceCorrect` did not chain — the most serious defect found so far.** It read
  `(select Balance from Ledger where Number = Number - 1)`; both `Number`s resolve to the subquery's
  own column, so the predicate was `Number = Number - 1` — never true. The lookup always returned
  nothing, `Coalesce` made it `0`, and **every chit's `Balance` had to equal its own delta**. The
  consequences compound: `PerspectiveBalance` reads the latest row's `Balance`, so it reported the
  last chit's amount rather than the tally balance; and `WithinCreditLimits` gates against that, so
  **the credit limit was per-chit, not cumulative — any limit could be exceeded by issuing enough
  small chits.** **Fixed**: `where L.Number = New.Number - 1`. The closing gate three constraints
  below already spelled it correctly, which is what makes this a typo rather than a design choice.
- **`Ledger.ValidIssuer` referenced a column that does not exist**, making the table uninsertable
  exactly as `TallyContract` was. The schema's own comment flagged it as a draft placeholder from
  when the ledger stored the issuer's Sid rather than an `'S'`/`'F'` side code, left for separate
  triage. It could never be evaluated, so it had no semantics to preserve, and the only validation
  it plausibly intended is already done by the column check `Issuer in ('S','F')` plus
  `SignerAuthorized`. **Removed** as dead code, with the reasoning left in its place.
- **A chit's digest names the issuer under an alias saying recipient.**
  `Ledger.SignatureValid` computes `case when Issuer = 'F' then FoilSid else StockSid end
  RecipientSid` — the foil's Sid for a foil-issued chit, which is the *issuer's*. Cryptographically
  harmless (both sides compute the same thing), but a trap for anyone writing a second
  implementation from the schema, which is precisely how signature divergence happens. **Recorded,
  not changed** — renaming it changes no bytes, but it should be renamed deliberately.
- **`PartyKeyRevocation.NotLastKey` never runs.** Every in-process route to an empty authorized set
  is closed earlier by `RevokerAuthorized`: the live `AuthorizedKey` view already excludes the
  in-flight revocation, so a key cannot revoke itself, and in a batch the first revocation excludes
  the second's signer. The case `NotLastKey` was written for — two *concurrent* transactions, A
  revoking B while B revokes A, colliding on no primary key — is one this harness structurally
  cannot reach. **The last-key guarantee therefore rests entirely on Optimystic re-evaluating the
  deferred CHECK against the latest committed snapshot**, which `docs/STATUS.md` § Cross-repo lists
  as unconfirmed. A test records this so it is not mistaken for covered.
- **The invoice tests pin behaviour `feat-invoice-lifecycle` intends to replace.** Today's schema
  models a request as a small contract: exact-match payment, no withdrawal, and a time-derived
  expiry. The § 7 tests confirm all three hold *as written* — one chit, exact units, only the payer
  may decline (`DeclinerIsPayer`), and a requester who invoices the wrong amount has no way to
  retract it. The ticket argues a request is not a contract and asks for part payment, withdrawal
  and aging instead of expiry. So these tests are a faithful record of the current schema, not an
  endorsement of it, and the ones on exactness and expiry are the ones that will change when that
  ticket lands. Noted here so a later failure reads as intended, not as a regression.
- **The credit gate can mask `InvoiceLink`.** A refusal test asserting a specific constraint has to
  make sure the earlier gates pass first: a requester-issued chit answering its own invoice fails
  `WithinCreditLimits` before `InvoiceLink` is reached whenever the counterparty granted no credit.
  Not a schema defect — a note about how to write these tests, since the first draft of that one
  passed for the wrong reason.

- **A zero balance reads as negative zero on the foil side.** `PerspectiveBalance` computes
  `Balance * -1` for the foil, and `0 * -1` is `-0` in JavaScript; it comes back through Quereus as
  one. Harmless in arithmetic, in `===`, and in JSON (`-0` serializes as `0`), but `Object.is(b, 0)`
  is false for it and so is a naive deep-equality comparison — which is how it was found. Not worth
  a schema change; a display or API layer should normalize (`b + 0`) rather than assume.
- **Close and invoice tests both hit the credit gate first.** Twice now a refusal test asserting a
  specific constraint passed for the wrong reason because `WithinCreditLimits` (or, once a pledge is
  open, `WithinReservedCredit` on the *Ledger*) answered before the constraint under test. The
  fixture's default `samGrants: 0` is the cause: Jan cannot issue at all. Pass `samGrants` whenever
  a test needs the stock side to issue and the gate under test is not the credit gate.

- **`Ledger.SignerKey` and `Signature` were NOT NULL, so a lift finalize could never be inserted.**
  Both columns are documented "null for a finalize", and `KindColumnsConsistent` *requires* them
  null when `Kind = 'lift'` — but neither carried the `null` marker the schema uses elsewhere
  (`InvoiceId text null`, `LiftId text null`), so the two rules contradicted each other and the
  whole lift settlement path was uninsertable. Same class as the `TallyContract` defect: a table
  nothing had ever executed. **Fixed** (two `null` markers). Found while probing the projected-
  balance question, not by a test — § 10 keeps lifts stubbed, so nothing in this suite finalizes
  one. Worth a test when `feat-lift-referee-commit` re-grounds that path.
- **Opposite-direction lift pledges net, and the netting can breach a credit limit.** Sequentially,
  with one writer: pledge 10000 out, pledge 25000 in, let the incoming one finalize (finalizes are
  exempt from the credit gates by design) and the outgoing one void, and the settled balance lands
  past the limit the counterparty granted. `ReservedBalance` is one signed number and both reserved
  gates read it; a credit limit needs the one-sided worst case per direction instead. Filed as
  `feat-schema-directional-reserve`. Not the deferred-CHECK isolation question — this fails in
  order, with nothing racing.

- **A `TallyContract` could not be completed by two separate parties.** The row carries both
  signatures over one digest and needs both at insert, but nothing in the schema carried the
  *proposer's* contract signature to the accepter — `TallyContractProposal.Signature` covers a
  different message (it folds in `Proposer`), and the accepter does not hold the proposer's key.
  Every row-level test passed because the harness held both key pairs and `signContract` took
  both. **Fixed**: `TallyContractProposal` gained a `ContractSignature` column — the proposer's
  signature over the contract digest at `Number = SequenceNumber` — validated by its own
  constraint, and `signContract` now takes one live signer plus the relayed one. Safe to hand
  over: the signature covers every field, so an accepter that alters the contract cid, either
  terms revision, the denomination or the scale invalidates it (tested).
  **This is the finding that justifies the whole API step.** It is invisible from below — a
  row-level suite that plays both sides cannot see it — and it would have been found by the first
  real two-party client instead.

- **`TradingVariable` and `PartyCertificate` were uninsertable, and the schema had already
  flagged it as a tripwire.** Both used a *plain* ref in `RevisionMonotonicInt`
  (`Revision = max(Revision) + 1`) where `PartyKey` and `CreditTerms` use `committed.*`. A plain
  ref buffers the row being inserted, so `max(Revision)` already sees it and the check can never
  hold. `CreditTerms`' comment asked a future runner to adjudicate and said explicitly not to
  "fix" the siblings without evidence. There is a runner now and the answer is definite. **Fixed**
  (both read `committed.*`); the tripwire note is replaced with the resolution. Third table in
  this family, after `TallyContract` and `Ledger`'s finalize columns — *a table nobody had ever
  executed* is the recurring shape of defect in this schema.
- **`PartyKeyAdoption` had the same two-party problem as `TallyContract`.** `adoptKey` took the
  recovering party's *key pair* to make the self-signature, which only works in a test playing
  both sides: the counterparty attesting does not hold that key. **Fixed** the same way — the
  recovering party makes the claim (`adoptionClaim(sid, publicKey)` signed by the new key) and
  relays it; the builder takes the signature, not the pair. The API surfaces this honestly as two
  calls: `claimKey` on the recovering side, `adoptCounterpartyKey` on the attesting side. Twice
  now the same defect, found the same way — **a builder that takes two key pairs is the smell**.
- **`PartyCertificate` is not bound to any strand.** Every other signature in the schema binds
  either the tally `Cid` or the per-strand invitation key. A certificate's digest is
  `Digest(PartySid, Revision, Certificate)` — nothing strand-specific — so a certificate row
  signed on one tally can be copied into another where the party holds the same Sid. The schema
  reasons explicitly that seating tables do not bind `Cid` (they are written before `TallyCore`
  exists), and that is right; but `Stock`, `Foil` and `PartyKey` are all strand-bound *via the
  invitation key*, and this one is not. Since `docs/identity.md` makes "a party may deliberately
  present a different identity on a different tally" a design goal, replay defeats a choice the
  design intends. **Not fixed** — `Stock.InvitationKey` is available at seating and forever after,
  so `Digest((select InvitationKey from Stock), PartySid, …)` would close it, but changing a
  digest the schema deliberately reasoned about is Nate's call, not a unilateral one.

- **`CurrentTradingVariable` was quadratic in the journal's depth, and it sits on the lift path.**
  It resolved the latest revision with a correlated `TV.Revision = (select max(Revision) from
  TradingVariable T2 where T2.Sid = P.Sid)` in a left-join ON clause -- the **only** use of that
  idiom in the schema; every other resolver uses `order by Revision desc limit 1`. The correlated
  max is re-evaluated per candidate row, and `LiftLading` joins this view twice. Measured on the
  in-memory runner, one `LiftLading` read:

  | revisions | correlated max | `order by … limit 1` |
  |---|---|---|
  | 1 | 24 ms | 40 ms |
  | 60 | 308 ms | 53 ms |
  | 120 | 1 210 ms | 76 ms |
  | 240 | 5 505 ms | 142 ms |

  **Fixed** -- the view now matches the schema's own idiom. `TradingVariable` is insert-only and
  revisioned, so depth only grows, and these reads happen while pricing lifts.

- **Nothing in the schema declares an index, and every journal read is therefore linear.** Even
  after the fix above, cost still roughly doubles as a journal doubles (53 → 76 → 142 ms), so the
  `order by … desc limit 1` is scanning rather than seeking. The same shows on the write path: a
  chit insert measured 101 ms at ledger depth 0, 123 ms at 120, 170 ms at 240 and 241 ms at 360 --
  growing with the history it has to validate against. Two lookups inside `Ledger`'s own
  constraints are the worst exposure, because they hit **non-key columns on the table that grows
  without bound**: `InvoiceLink`'s `select count(*) from Ledger where InvoiceId = ?` and
  `LiftFinalize`'s `where L.LiftId = ? and L.Kind = 'lift'`, plus `OpenPendingLift`'s anti-join
  against the whole ledger, which `ReservedBalance` reads on every chit and every pledge. Quereus
  supports `create index` and materialized views; neither is used. Not a correctness problem and
  not urgent, but it is a real ceiling on a tally that trades for years.

## 1. Substrate

- [x] Every statement in `draft1.qsql` executes in Quereus
- [x] Every statement in `portfolio.qsql` executes
- [x] No constraint or default reads a clock or a random source
- [x] Host scalars agree with the schema's expectations: `DayNumber` ordering and UTC reading,
      `ValidDate` rejects non-dates, `Digest` is injective across argument boundaries and across
      types, `SignatureValid` round-trips a real key pair and refuses the wrong key or content
- [x] `Digest` here and `src/lift/digest.ts` produce identical bytes — the store scalar *delegates*
      to the lift module's canonical encoding rather than carrying a second one *(the first draft
      did carry a second one; the test caught it)*

## 2. Identity and keys

- [x] An authorized key admits another, and the **counterparty's** engine accepts it unprompted —
      which is what makes a revocation containable without the counterparty noticing
- [x] A key cannot admit itself (`AuthKeyAuthorized`, read against the committed snapshot)
- [x] Authority does not cross the party boundary: the counterparty's key cannot admit one
- [x] `Revision` is contiguous — a gap fails `RevisionMonotonicInt`, a reuse collides on the PK
- [x] The same key cannot be registered twice (`UniqueKey`)
- [x] A surviving device retires a lost one; both engines stop accepting it
- [x] A revoked key cannot authorize, cannot revoke, and can never be re-added
- [x] A key cannot revoke itself, so the last key survives — by `RevokerAuthorized`, **not** by
      `NotLastKey`; see § 0
- [x] Counterparty adoption: two signatures over one digest — possession by the recovering party,
      attestation by the counterparty. Neither alone is enough
- [x] An adopted key can authorize fresh device keys, so recovery does not stop one step short
- [x] A party cannot attest for itself (`CounterpartyIsOther`); an adopted key is revocable like
      any other
- [ ] *needs-transactor* — concurrent double-revocation: exactly one commits, the party keeps a key
- [ ] A `Sid` is the hash of its genesis key *(claimed by the docs, unenforced — see § 0)*

## 3. Formation

- [x] Seating is **atomic and circular**: `Stock.SignerAuthorized` needs the inviter's `PartyKey`,
      and the genesis `PartyKey` signature validates against `Stock.InvitationKey`. Neither row goes
      in alone; only a transaction whose subquery CHECKs defer to COMMIT seats anybody
- [x] Stock side: `Stock` + genesis key, signed by an authorized key of the inviter
- [x] Foil side: the `Foil` row is signed with the **invitation secret** — the only thing tying the
      responder to this strand. A responder without it is refused (`InvitationSignatureValid`)
- [x] A genesis key cannot authorize its own admission (`SignatureValid` against the invitation key)
- [x] A second responder is refused — though by `TwoParties` on `PartyKey`, **not** by any rule on
      `Foil`, whose primary key is `(Sid)` rather than the singleton `Stock` uses. The protection is
      real but indirect; worth Nate's eye
- [x] A third party is never admitted (`TwoParties`)
- [x] `TallyCore` cannot be named before the invitee seats (`FoilSeated`)
- [x] `TallyCore.Cid` must address its own founding fields (`CidCorrect`), and both parties compute
      the same identity from them
- [x] The **initiator** names the tally; the invitee signing it is refused (`SignerAuthorized`)
- [ ] Both `Stock` and `Foil` are insert-only: no update, no delete
- [ ] The denomination is fixed at formation and never changes
- [ ] A certificate discloses only what its party chose *(story 11; `feat-disclosure-selection`)*

## 4. Negotiation

- [x] A proposal is signed by the side it claims to come from; the other side's key is refused
- [x] An offer carries **both** parties' terms revisions, so it is a complete proposition
- [x] Countersigning makes a tally: one `TallyContract` row carrying both signatures over one digest
- [x] One signature is not a tally — the same party signing both halves is refused
- [x] A contract cannot lock terms revisions that were never published
- [x] A key revoked before countersigning cannot complete the contract — authority is checked when
      the row is written, not when the key was issued
- [x] The denomination accepts `CHIP`, `iso4217:AAA` and `cid:<address>`, shape only, and refuses
      `iso4217:usd`, `iso4217:US`, `iso4217:USDX`, `cid:` and bare words
- [x] **FINDING** — there is no counter-offer, no offer history and no expiry; see § 0
- [ ] Two proposals fully signed at once: the later-drafted one governs *(unreachable — one proposal
      row exists; `feat-offer-lifecycle`)*
- [ ] An expired proposal cannot be countersigned *(nothing expires)*
- [ ] A refusal is visible to the offeror *(open: `feat-offer-lifecycle`)*
- [ ] Derived state reads `Forming` before any contract, `Open` after *(blocked on
      `feat-schema-tally-state`)*
- [ ] Renegotiation: a later countersigned proposal becomes a new `TallyContract` revision

## 5. Credit terms

- [x] A grantor's terms are unilateral — grantor-signed, and the counterparty's engine accepts them
      without having agreed to anything
- [x] A party cannot publish terms in the other's name (`SignerAuthorized`)
- [x] A stranger to the tally cannot publish terms at all (`PartyOfTally`)
- [x] A permissive change (limit up, notice unchanged) takes effect at once
- [x] A restrictive change must wait out the notice period *already agreed* — one day short is
      refused
- [x] Shortening the notice period is itself restrictive, so it waits like any reduction
- [ ] Absent any `CreditTerms` row the effective limit is zero, so the first nonzero chit fails
- [ ] A future-dated restrictive revision and a later immediate permissive one coexist correctly

## 6. Direct chits

- [x] A chit is signed by the party it makes worse off, and needs no countersignature — one
      signature moves the tally
- [x] The other party cannot sign it (`SignerAuthorized`) — Jan cannot put Sam into debt
- [x] A signature over different content is refused (`SignatureValid`) — the shape of a chit
      tampered with in flight
- [x] `Units` must be positive; direction comes from `Issuer`, not the sign of the amount
- [x] `Balance` chains: it accumulates, both parties read the same running total, and a balance
      equal to the chit's own delta is refused
- [x] Wrong arithmetic is refused in either direction
- [x] The credit gate admits a chit inside the grantor's effective limit and refuses one past it
- [x] The gate is **cumulative, not per chit** — the consequence of the chain bug above
- [x] Each side binds separately: a party that granted nothing may be owed nothing
- [x] With no terms published, nothing may be owed
- [x] `DateMonotonic`: a chit dated before its predecessor is refused; the same day is fine
      *(`docs/timestamps.md`)*
- [x] The date selects the credit epoch — a chit dated before a restrictive cut takes effect gets
      the old limit, one dated after gets the new one
- [x] A chit's `Id` is inside its signed digest, so it cannot be assigned by the store
- [x] **FINDING** — the digest names the issuer under an alias saying recipient; see § 0
- [x] Every act is validated independently by both parties' engines *(the harness does this for
      every test; `DisagreementError` is raised where they differ)*
- [ ] *needs-transactor* — the same chit reaching both replicas concurrently

## 7. Invoices

`src/tally/invoices.ts` + `invoices.test.ts` (24 tests). Jan (stock) invoices Sam (foil); Sam issues
the answering chit, which is the one that has to fit inside the credit Jan granted. See the § 0
finding on `feat-invoice-lifecycle` before changing any of this.

- [x] An invoice is signed by the party asking to be paid — `SignerAuthorized` resolves the key
      against the *requester's* own set, so Sam cannot write himself a bill in Jan's name
- [x] Altering the units after signing breaks `SignatureValid`
- [x] `ExpiryValid` refuses an expiry before the invoice date
- [x] It is answered by exactly one chit, from the opposite side, for the exact units — a
      requester-issued chit, a second chit, and a chit naming an unknown invoice all fail
      `InvoiceLink`
- [x] Partial payment is refused; an unlinked chit of a different amount settles value and leaves
      the invoice `open`
- [x] A decline is recorded and visible to both parties; only the payer may file it
      (`DeclinerIsPayer`), at most one per invoice (the primary key, not a named constraint), never
      after payment (`NotPaid`), and a declined invoice can no longer be paid (`InvoiceLink`)
- [x] `InvoiceExists` and `SignatureValid` gate the decline the same way
- [x] State precedence is `paid > declined > expired > open` — covered at `paid > expired` and
      `declined > expired`; `paid > declined` is unreachable in-process (each excludes the other at
      insert) and exists only for the concurrent case, same shape as `NotLastKey` above
- [x] A late payment of an expired invoice succeeds and reads as `paid`
- [x] An invoice may exceed current capacity; only the answering chit is credit-gated
      (`WithinCreditLimits`)
- [x] `OpenInvoice` lists the open ones and nothing else

Expiry leans on `Today()`, the schema's one volatile function. The tests pin it with a date that has
already passed and always will have, rather than by faking a clock.

## 8. Close

`src/tally/close.ts` + `close.test.ts` (13 tests). The claim under test is that a *unilateral*
close is safe, which rests on closing freezing balance growth while always permitting reduction.

- [x] Either party may file a `CloseRequest` at any time, without the other agreeing; both may
      file, each once (the primary key), and both replicas read `closing` immediately
- [x] `SignerAuthorized` and `SignatureValid` gate it the same way as `Invoice` / `InvoiceDecline`
- [x] While closing, a chit that moves the balance toward zero is admitted — from a positive
      balance and from a negative one, so whichever party holds value can always collect it
- [x] While closing, a chit that moves it away from zero is refused (`ClosingReducesBalance`)
- [x] A sign-flip overshoot is refused — `+30000 → -5000` reduces the number but mints new credit
      in the other direction, which is what the same-sign form exists to stop
- [x] The lift half of the safety argument: a pledge that reduces the *reserved* balance is
      admitted, one that grows it is refused (`ClosingReducesReserved`) — so the counterparty can
      lift the value out as well as be paid down
- [x] `CloseState` reads `open` with no request, `closing` with one, `closed` once settled at zero
      with no open pledge; a settled zero with a pledge still open stays `closing` (the
      load-bearing clause — otherwise a later finalize would bump a "closed" tally off zero)
- [x] A settled close is terminal *(`debt-tally-close-no-reopen`)* — at a prior balance of zero
      both arms of `ClosingReducesBalance` are false, so every further direct chit is rejected with
      no separate constraint
- [x] Withdrawing credit is **not** a close: it is restrictive, so it owes the counterparty its
      `CallDays` of notice before it binds, it is reversible, and `CloseState` stays `open`

The pledge rows here are built by hand in the test — `src/tally/` has no lift surface yet (§ 10),
and these exercise a *close* gate rather than starting one.

## 9. Reading

`src/tally/reading.test.ts` (8 tests). Every view is derived; nothing here writes state a later
read depends on.

- [x] `PerspectiveBalance` states the same figure oppositely to each party, and reads identically
      on both replicas rather than only on the reader's own
- [x] `CurrentCreditLimit` returns the terms in force, not the latest filed — a future-effective
      withdrawal is ignored until it binds, a raise (which owes no notice) is picked up at once,
      and a party who granted nothing reads zero
- [x] `ReservedBalance` includes open pledges; `PerspectiveBalance` does not — an open pledge
      shrinks what a party can still commit without moving what it is owed
- [x] Reading a tally with no activity returns a coherent zero, not an error: formation and nothing
      else, and every view still answers
- [x] A zero balance reads as `-0` to the foil side (see § 0)

## 10. Stubs — not built, asserted absent

- [x] Lift pledge/finalize/void constraints are exercised by `src/lift/*` against doubles. § 8
      inserts a real `PendingLift` on a real strand — enough to drive the two close gates and the
      `OpenPendingLift` / `ReservedBalance` views — but nothing here finalizes or voids one, and
      `src/tally/` carries no lift surface. Re-grounding the resolution path is deferred to
      `feat-lift-referee-commit`.
- [x] Network discovery, routes and referees: `src/lift/` covers the protocol in process; nothing
      here opens a socket
