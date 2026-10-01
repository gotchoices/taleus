# taleus-model

The Taleus apps' shared model: everything a Taleus app's screens can read and do, behind one
interface, `TaleusModel`. Screens never learn what answers them.

```
screens ─▶ app data layer (src/data, thin) ─▶ TaleusModel ─┬─▶ mock: fixtures + in-memory writes
                                                           └─▶ engine: taleus-core   (next)
```

## What lives where

| | |
|---|---|
| `src/<namespace>.ts` | Shapes, policy constants, pure derivations, and `<Namespace>Model` — the contract. Shared by every implementation. |
| `src/model.ts` | `TaleusModel` (all namespaces) and `MockControls` (variant, resets). |
| `src/mock/` | The mock implementation: fixtures and in-memory writes. |
| `src/types.ts` | Shapes used across namespaces (`Amount`, `Result`, `TallySummary`…). |

Each namespace is also a subpath export (`taleus-model/attention`), because some shape names repeat
across namespaces (`Terms`, `Agreement`, `Delivery`).

## Rules

- **Framework-free and platform-neutral.** No React, no React Native, no Node at runtime. Platform glue
  — UI bindings, startup, storage, formatting — belongs to each app target.
- **The Taleus product's model, not a general one.** Every Taleus target shares it. A different product
  on Taleus builds on `taleus-core` directly.
- **Fixtures are injected.** React Native bundles a JSON file only through a static `require`, so the
  app supplies a `FixtureSource`; tests read `../taleus-app/mock/data` off disk.
- **Every operation is async**, even where the mock answers at once, because the engine behind it will
  not.

## Consuming it

A Taleus app target depends on it as `"taleus-model": "file:../../../taleus-model"` and consumes the
built `dist/` (`yarn build` here, or `tsc -p tsconfig.build.json --watch`). Metro needs the package in
`watchFolders` and the app's `node_modules` in `resolver.nodeModulesPaths`; Jest needs the same in
`modulePaths` — linked code otherwise looks for Babel's injected helpers beside its own real path.
