description: Run the Taleus app over a real Sereus cadre — each tally its own Optimystic-backed strand, persisted on the device and shared with a real counterparty by invitation — waiting on the phone-node bring-up moving into Sereus's React Native kit so Taleus need not copy it.
prereq: feat-engine-run-modes
files: packages/taleus-model/src/engine/, packages/taleus-app/apps/mobile/src/data/config.ts, packages/taleus-app/apps/mobile/src/data/engine.ts, packages/taleus-core/src/api/types.ts
difficulty: hard
----

## Why blocked

Mode C needs an embedded cadre node on the phone: identity in the secure store, durable node-local
stores, start/stop, background/foreground handling. Today every Sereus phone app carries its own copy
of that bring-up (the reference app, sereus-chat, health), and the copies have drifted — chat's and
health's miss parts of cadre-core's host contract (identity in plaintext, node-local stores left in
memory, no AppState handling, un-awaited async calls). Sereus's own
`tickets/backlog/feat-rn-kit-secure-key-store.md` says the bring-up moves into `@serfab/cadre-rn`
once a second app needs it. Rather than make a fourth copy, Taleus waits for that to land.

**Unblocks when:** `@serfab/cadre-rn` publishes the key-store, node and lifecycle subpaths (stacked
PRs to gotchoices/sereus, built from the reference app's bring-up), or Taleus links a local sereus
checkout that carries them.

## The plan, once unblocked

- **`CadreStoreProvider`** (in `taleus-model`, platform-neutral, given a `CadreNode`) implementing
  taleus-core's `StoreProvider`:
  - `create` → `foundStrand({ type: 'c', memberPrivateKey, sAppConfig: draft1 })`
  - `join` → `redeemInvitation` → `addStrand`, then wait until the strand is writable (a joiner
    has no database until the strand's header arrives)
  - `query`/`apply` → `strand.database.getDatabase()`, writes in one transaction
  - `subscribe` → Quereus watchers for local writes; replicated writes need an event too —
    find how chat learns of incoming messages before falling back to polling
- **Two-layer invitation:** the envelope carries the Sereus strand invite (join the strand) and the
  Taleus seat credential (claim the seat). Formation needs both phones online, as in chat.
- **Persist what Mode B kept in memory:** the Taleus identity secret (key store) and the session's
  device-local state (invitations made, intended terms, display name).
- **Verify** with two emulators forming a tally, then two phones.
