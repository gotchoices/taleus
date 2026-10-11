# Taleus — Status & Open Items

A working checklist of items that are awkward to file as individual tickets, plus **cross-repo**
items (Sereus / Optimystic / Quereus) that Taleus depends on but cannot fix itself. This file is
**not timeless** — prune entries as they land. Timeless design lives in [`docs/`](.); discrete work
items live in [`tickets/`](../tickets/).

## Cross-repo: stack hardening Taleus depends on

Taleus's entire safety model rests on the Sereus/Optimystic/Quereus substrate enforcing signature-
and existence-constraints on every write. The following are **not** Taleus bugs — they are
dependencies to confirm or harden in the sibling repos. A fuller write-up (with file:line
citations) is prepared separately for transmission to Nathan; this is the digest.

- [ ] **Stack: on Sereus 1.12 / Optimystic 1.10.1 / Quereus 4.20.1 / FRET 1.0.1, one copy each;
  upgrading to Sereus 1.14 / Optimystic 1.12.1.** `taleus-core` depends on `@quereus/quereus` and
  `@optimystic/quereus-plugin-crypto` directly; the prescribed-usage checklist the Sereus adapter must
  follow is in `packages/taleus-core/SPEC.md` § Where Sereus plugs in.
- [ ] **Upstream items we filed** (2026-10-05):
  - gotchoices/sereus#33 — native Ed25519 in `@serfab/cadre-rn` (`/polyfills/native-crypto`). Open.
    When it ships, the mobile app drops its own `src/polyfills/native-crypto.js` for the kit's.
  - gotchoices/Optimystic#30 — `quereus-plugin-crypto` has no native-crypto seam: its SQL `verify` runs
    pure-JS Ed25519 (408 ms of a 29 s invite on a Galaxy S7). Open.
  - gotchoices/Optimystic#31 — cohort-topic proof-of-work starved the phone's JS thread. **Fixed in
    Optimystic 1.12** (keyed nodes skip it); lets the phone run `strandReactivity` again.
- [ ] **Read-dependency validation must be live on the consensus commit path — now for cross-table
  rules only.** Sereus guarantees that a declared unique value (primary key or secondary index)
  refuses the second of two racing rows, so every "at most one" rule in the schema is now a
  `unique` index rather than a counting CHECK: one chit per invoice, one finalize per lift, one
  registration per key, and the new one-chit-per-id that makes a retried payment safe. What still
  relies on Optimystic rejecting a stale read set is the cross-table rules no index can express:
  concurrent double-revocation (`NotLastKey`), finalize-vs-void, and pay-vs-decline.
  **Acceptance:** a two-node integration test that fires the concurrent double-revocation and
  asserts exactly one transaction commits.
- [x] **Transactor-backing rule — checked upstream, and far less exposed than this entry claimed.**
  `@serfab/quereus-plugin-sereus` takes `transactor: 'local' | 'network' | 'test'` as a **closed
  union**, all three of which commit through Optimystic's transactor stack and therefore through
  Quereus DML, so SQL constraints fire. It defaults to `'network'`, and `parseConfig` *throws* on an
  unrecognised value rather than falling back. `quereus-sync` is a separate package and is not a
  dependency of the plugin anywhere in Sereus — it is not reachable by misconfiguration, only by
  someone deliberately wiring a different stack. Residual rule, stated once: **do not.**
- [ ] **Partition behavior for time-sensitive actions.** Optimystic is CP: a cadre in the minority
  partition cannot commit, so a party **cannot revoke a stolen key while partitioned**, widening
  the key-compromise race window by the partition duration. Understand and document the bound.
- [ ] **Per-node latch-deadlock bug** on concurrent writes to the same block (Optimystic internals):
  a local liveness bug, not an isolation-correctness hole. Track its fix upstream.

## Taleus design docs — written (this pass)

- [x] `docs/index.md` — front door / table of contents (`AGENTS.md` repointed).
- [x] `docs/trading-variables.md` — two-sets (4-per-party) model and number-line economics.
- [x] `docs/denominations.md` — UoA quantification (designator / integer sub-units / multiplier + descriptor).
- [x] `docs/tally-lifecycle.md` — negotiation state machine, contract governance, rights invariant, wedged-state taxonomy.
- [x] `docs/concurrency-model.md` — CRDT lens + the isolation finding above.
- [x] `docs/drafts/credit-terms.md` — **draft** (not settled): rich-terms roadmap (interest / amortization / vesting).

Possible future split: break `architecture.md` into topic files if it grows unwieldy (manageable as one
file for now).

## Core build — bottom-up (started)

Direct chits, tally negotiation and management. Network queries and lifts stay stubbed; the lift
module keeps its in-process suite against doubles until direct chits work on a real strand.

- [x] `packages/taleus` renamed **`taleus-core`** — platform-neutral, Node/RN/browser. "Engine" is
  now the generic notion; an app-specific layer belongs *in the app*, not in a core library.
- [x] `docs/drafts/engine-api.md` moved to `packages/taleus-app/design/notes/core-asks.md` — it was
  written from the app's side and is one app's wish-list, not a core specification.
- [x] **The schema executes.** All 33 statements of `draft1.qsql` load into Quereus in memory, with
  host scalars registered (`src/store/`). Nothing had ever run it before — the lift suite uses an
  in-memory double its own harness calls "schema-EMULATING".
- [x] `docs/timestamps.md` — the creator asserts and signs the time; what backdating buys a byzantine
  party on a direct chit, and what bounds it.
- [x] **The low-level suite is complete** — §§ 1–9 of
  [`packages/taleus-core/test/STATUS.md`](../packages/taleus-core/test/STATUS.md): substrate,
  identity and keys, formation, negotiation, credit terms, direct chits, invoices, close, reading.
  240 tests over 20 suites, every act proposed to two replicas that each re-validate it. Five schema
  defects were found and fixed along the way (see that file's § 0).
- [x] **The API surface is built and exercised.** `packages/taleus-core/API.md` + `src/api/`: one
  consumer surface that names no table, an engine over it, and an in-memory multi-party store so it
  runs today. Two parties go from invitation to close through the API alone. It surfaced a defect
  no row-level test could: a `TallyContract` could not be completed by two parties who do not share
  a key (fixed — see that package's `test/STATUS.md` § 0).
- [x] **A store over real strands.** `taleus-model/cadre`'s `cadreStoreProvider` founds a tally strand,
  invites, joins, seats and trades between two cadre-core nodes in Node, across a restart
  (`cadre.test.ts`). Details and what remains: `tickets/blocked/feat-engine-cadre-mode.md`.
- [ ] Migrate the row-level suite up per `test/STATUS.md` § Roadmap step 4.
- [ ] Mine `mc/mychips/test/auto` for scenarios (5,543 lines; the code does not transfer, the
  scenarios do).

## Taleus open decisions / small items

- [ ] **Rename `chipnet` → `tallyNet`** (or similar): branding sweep across docs, code (`src/lift/`,
  `src/transport/`, `/taleus/chipnet/1.0.0`), and tickets. (Noted in `docs/index.md`; sweep not yet done.)
- [ ] **Rational vs. decimal denomination multiplier** — decide whether to extend beyond `10^n` for
  non-decimal units, and if so carry the rational in the `cid:` descriptor's `canonicalUnit`. Captured in
  `docs/denominations.md`; decision open.
- [x] **Contract-governance principle** — captured in `docs/tally-lifecycle.md § Contract governance`
  (direct chits grantor-authorized anytime; lift chits per signed trading variables; good-faith timing).
- [x] **Lift-chit ↔ trading-variable conformance is agent-enforced, not schema-gated** — documented in
  `docs/trading-variables.md` (pledge is self-signed; `LiftLading` is advisory; hard gate is the credit
  limit). Confirm-no-schema-guard stands as the resolved position; revisit only if a concrete attack appears.

## Apps (planned)

The engine (Nathan's work) is consumed by apps. Kyle authors these using the **appeus** format
(story-driven app authoring, as in `ser/health`, `ser/chat`).

- [x] House engine-consuming apps in `packages/taleus-app/` (appeus project root; targets land in
  `packages/taleus-app/apps/<target>/`). Supersedes the earlier "top-level `apps/` folder" plan.
- [x] Initialize the appeus format there (hosted mode: appeus owns only `design/`, `apps/`, `mock/`,
  and its rules symlinks; repo root files untouched).
- [x] Complete discovery: `packages/taleus-app/design/specs/project.md` — React Native (bare, TypeScript),
  npm, identity `org.sereus.taleus`, three data run modes, multi-language from the first slice.
- [x] Scaffold the `mobile` target and draft the tally-negotiation stories (01–04, with a stubbed story
  map covering the rest of the MyCHIPs baseline).
- [x] Each `apps/<target>/` is a standalone npm project, outside the root yarn workspaces.
- [ ] Write the remaining stories (see `packages/taleus-app/design/stories/mobile/00-story-map.md`).
- [x] **`packages/taleus-model`: the apps' shared model.** One `TaleusModel` interface with two
  implementations -- the mock (moved out of the mobile app unchanged) and the engine over taleus-core,
  with a simulated counterparty for one-device use -- and one contract suite run against both. The
  app's data layer forwards to it, so screens see no backend at all. Wiring engine mode into the app
  is next -- `feat-engine-run-modes` § Progress.
- [ ] **Run a cadre node for Taleus.** Not done: being prepared in a separate effort. The phone
  app's Mode C (below) runs a phone node through `@serfab/cadre-rn`; an always-on cadre node serving
  a party's tallies (and `taleus-node`, `feat-taleus-node-service`) is the part still to come.

(The `feat-taleus-app-shell` ticket has been retired — the app is scaffolded and now evolves through
the appeus design/generation cycle. Toolchain decisions live in `design/specs/project.md`.)

## Mode C: the phone app over a real cadre (`feat-engine-cadre-mode`)

Runs on an emulator and a Galaxy S7 against the public relay (`relay.sereus.org`): onboarding,
invitation, acceptance and trading work, but slowly. Measured on Sereus 1.12 / Optimystic 1.10.1:
invite 29 s (S7) to 71 s (emulator); accept 256 s (join about 3 min, seating 44 s); reads 9–70 s or
more, and the tally list times out. The dev bridge (`apps/mobile/scripts/dev-drive.mjs`) drives it
without the UI.

- [x] **Upgraded to Sereus 1.14 / Optimystic 1.12.1 / Quereus 4.20.2 / FRET 1.0.2** (2026-10-08); core
  301 and model 35 tests pass; the phone runs `strandReactivity` again. A device's control store from
  1.12 does not open under 1.14 (Sereus's documented no-migration policy: the party is recreated).
- [ ] **Re-measured on 1.14 (emulator accepts the S7's invitation): still failing.** Invite 28 s on
  the S7. Accept: the first strand start failed after 173 s (`optimystic/schema` unavailable,
  `claimed-elsewhere`), the automatic retry started it in 24 s; a second accept waited 245 s for the
  first sync; a third got the strand writable and then failed after 235 s reading
  `PartyKeyRevocation` (`cohort-unreachable`), with the two strand nodes connected through the relay.
  Meanwhile the S7's agent runs a step every 10 s (the backstop poll) costing about 2.7 s each.
- [ ] **Second run (backstop poll at 120 s, both parties fresh, 2026-10-09): the accept completes the
  join but seating never lands** — strand first sync 222 s, then reads of 168–226 s, then the
  three-row seating transaction 300 s; both sides still show the tally Forming. An S7 CPU profile
  over the first sync: busy 168 of 240 s, almost all in the network stack (libp2p streams, Noise,
  WebSockets, yamux, circuit relay, peer-store; cadre-rn's Noise crypto 27 s, a third of it creating
  a quick-crypto cipher object per frame; peer-store address sorting with `localeCompare` 8 s);
  Quereus and Taleus code barely register. After seating, the emulator issued 149 slow reads in a
  minute, mostly repeats (`TallyCore` 30 times).
- [x] **Shared reads** (`taleus-core` `SharedReadStore`, 2026-10-09): one store per tally in the engine;
  identical reads in flight or answered since the tally last changed share one query (held at most
  5 s); a write or any change heard drops them.
- [ ] **Third run (shared reads, gate log on): the accept completed, 540 s** — strand database
  initialize 135 s; the first-sync probe 155 s, failing at `App.CloseRequest` (a table nobody had
  written: `cohort-unreachable`, "could not determine whether it exists"); re-probes 51 s; the
  three-row seating transaction 128 s. **Then the inviter never saw the seat:** 28 minutes later,
  and after a restart, the S7 answered `select Sid from App.Foil` empty in 87 ms, so its agent
  could not establish the tally. Not yet confirmed what the joiner holds (the emulator stopped
  loading its bundle under host load). Candidate upstream issues: a joiner's rows in a table the
  founder never wrote stay invisible to the founder; and the first-sync gate reads the App tables
  one by one and restarts from the first on any failure (`strand-first-sync-gate.ts`
  `appTablesReadable`), so its cost grows with the table count and the slowest peer.
- [ ] **Reproduced in Node, filed as gotchoices/sereus#44:** a joiner's strand node holding only the
  relay connection when its strand becomes writable commits with a cohort of itself
  (`commit:solo-cohort`, `quorum: 'local'`), reports success, and the rows are lost if it stops.
  Sereus scenario `joiner-first-commit-over-slow-relay` (branch
  `test/joiner-first-commit-over-slow-relay`, worktree `ser/sereus-wt-repro`), 3 of 3 runs on a
  20 ms serial frame cap with a 70%-busy event loop; loopback and 100 ms pass.
- [ ] **Upstream, once Taleus's own volume is cut:** phone transport cost (per-frame cipher objects in
  `@serfab/cadre-rn/noise-crypto`, libp2p peer-store churn), with the S7 profile as evidence.
- [ ] **Held, pending the re-measure:** a joiner's first write failing to get a super-majority
  (retried today); a restarted joiner not syncing (seen with a local relay only); an untraced
  uncaught "Database is closed".
- [ ] An acceptance that outlives `joinPatienceMs`; reads failing while the counterparty is offline;
  half-committed seating; a signed tally sApp; verify on two phones (all in the ticket).
- [ ] **Clean-up:** `TMPDBG` logs in `taleus-model` (`cadre/store.ts`, `engine/session.ts`,
  `engine/formation.ts`); `USE_ENGINE`/`USE_CADRE` back to `false` in `apps/mobile/src/data/config.ts`;
  `probe-*.tmp.mjs` at the root and `profile.tmp.cjs` in the app.

## Contracts (Stroc)

sereus.org publishes the tally contracts from [`contracts/`](../contracts/) as Stroc documents into
its shared catalog (`https://sereus.org/.well-known/stroc/catalog.json`): two offerable agreements,
**Taleus Tally Agreement (Courts)** and **(Arbitration)**, a non-binding **Testing** agreement, and
the clauses they include. A tally signs only its contract's CID. The documents travel **in the
strand**: a `Document` table, insert-only, keyed by CID, which whoever holds a document fills if it
is missing -- so the partner "asks" for a contract by reading the table, and no Sereus protocol is
needed. A tally whose contract cannot be read in full is a reason to decline it.

- [x] Documents drafted, published, served by sereus.org; `@stroc/cli` installed (`yarn stroc`).
- [x] **Stroc collections** (Stroc 0.3, catalog 1.1): `contracts/.stroc.yaml` lists the Courts and
  Arbitration agreements in `tally-contracts`; the model offers each source's current entries of it.
- [ ] **Publish** the catalog with collections (`contracts/publish.sh`): until then the live catalog
  is 1.0 and the app offers only agreements imported by link.
- [ ] **Upstream: `cid()` names dag-json** (gotchoices/Optimystic#33, open): the crypto plugin's
  `cid()` already builds CIDv1s and lacked only Stroc's codec. Once released, `Document`'s interim
  `CidFormat` becomes `check (Cid = cid(Json, 'dag-json'))`. Until then every reader verifies.
- [x] **Schema:** `Document(Cid, Json)` (insert-only, network-watched, interim CID-format check);
  `TallyContractProposal.ContractStored` requires the offered contract in `Document`. Core: offers
  carry `documents` (stored `insert or ignore`), `Tally.document(cid)` reads one back.
- [ ] **Schema, later:** the hash check above.
- [x] **Engine and model** (`taleus-model/contracts`, tested in Node, including the two-node strand
  test where the invitee reads the contract from the tally):
  - a per-device list of document sources, seeded with sereus.org; a source is added when the user
    imports a contract from it, without being asked to think about "publishers";
  - the offerable agreements = current `author` entries of the Taleus kind across those sources;
  - a per-device document store (LevelDB on the phone) as a cache;
  - an offer writes its contract and every document it includes into `Document`;
  - `readAgreement(cid)` reads the strand, then the cache, then the sources, verifying each copy;
  - the agent declines an offer whose contract cannot be read in full;
  - `STANDARD_AGREEMENT` removed. No mock-mode work for now.
  - NOTE: "declines" is the agent not accepting -- the core has no refusal act yet
    (`feat-offer-lifecycle`).
- [x] **Phone spike** (S7, 2026-10-10): listing sereus.org's agreements 27 s cold, 9 s warm; composing
  the Courts agreement (11 sections) 4 s from the device cache. Stroc runs in the app as is.
- [ ] **Native rendering** of the review screens from Stroc's layout model, with "issued by
  <domain>" and "you have read this before".
- [x] **Import by link** (model, `importAgreement`; S7 3 s, author confirmed): a
  `https://<host>/ipfs/<cid>` link is fetched with its includes, verified, its author checked, kept,
  and offered from then on; the host joins the device's sources. The QR scanner itself is a screen.
- [ ] **Design surface** (drafted 2026-10-11, awaiting review): stories 01, 02, 07 revised (see
  `stories/mobile/STATUS.md` "Ready for review"); a new `Agreement` reading screen and `Scan` taking
  an agreement's code in the navigation and screen plan; the agreement asks in
  `specs/domain/interfaces.md`. After review, the model still owes the screens: the issuer check on
  every agreement shown (today only on import), a per-device record of agreements read, and the
  composed document's structure (not flattened text) for native rendering.

## Negotiation gaps (app design pass, `packages/taleus-app`)

Filed as tickets from the app design pass:

- `feat-offer-lifecycle` — offer history, expiry, simultaneous acceptance, and whether refusal is
  recorded at all (`TallyContractProposal` is a single mutable row today, with no expiry).
- `feat-formation-lifecycle` — what an invitation nobody accepts leaves behind.
- `feat-standing-invitation` — a vendor's reusable invitation; Sereus records one use per invite today.
- `feat-engine-tally-api` — the app-facing surface for the whole tally lifecycle. Re-scoped by the
  bottom-up build: `taleus-core` grows the tally surface from the schema up, and reconciliation with
  what any one app wants comes after, not before.
- `feat-engine-run-modes`, `feat-attention-signals`, `feat-position-and-estimates`,
  `feat-disclosure-selection`, `feat-device-and-recovery-surface` — the rest of what the drafted
  stories need.

## Tickets spawned from the MyCHIPs-comparison analysis

- `tickets/backlog/feat-schema-rich-credit-terms.md` — **regression fix (committed):** restore interest /
  amortization / grace / minimum-payment / prepayment / maturity-vesting; design space in
  `docs/drafts/credit-terms.md`.
- `tickets/backlog/feat-schema-tally-state.md` — **regression fix:** materialize forming/offer/open/void
  negotiation state (MyCHIPs' signing dance), left only implicit in the reboot.
- `tickets/backlog/debt-tally-close-no-reopen.md` — terminal close / no reversal of a mistaken final payment.
- `tickets/backlog/feat-lift-healing.md` — repair a half-broken lift (partition / refuser / silent referee). **Speculative** — needs a dedicated design pass before implementation.
- Existing, re-scoped by this analysis: `feat-lift-timeout-release.md` (stuck pending lift),
  `feat-multi-referee-consensus.md` (single-referee third-party value-loss).
