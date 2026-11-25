description: The TallySim Viewer's graph drawing and app shell have no automated tests at all — they only run in a real browser — so add a headless-browser smoke test that loads a network and checks it actually drew.
files: packages/tallysim-viewer/src/graph/render.ts, packages/tallysim-viewer/src/app/shell.ts, packages/tallysim-viewer/docs/design.md
difficulty: medium
----

The viewer's renderer (`render.ts`) and app shell (`app/**`) are browser-only: they need WebGL and a Web
Worker, which the jest/node test setup here cannot provide. Today their only gate is `vite build` (type-check +
bundle) plus a human running the app by hand. That leaves the whole visual/interaction tier — edge-capacity
encoding, hover tooltips, node search, the WebGL-absent fallback, theme switching, and the load/teardown
lifecycle (including worker cleanup) — with zero automated coverage. A regression in any of it would pass CI.

This ticket is to add a **headless-browser smoke test** (Playwright or equivalent headless-Chromium) that:

- mounts the shell, loads a small hand-built network (and/or the in-page sample), and asserts the sigma canvas
  actually rendered something (not a blank canvas, not the WebGL-missing message);
- exercises at least: a node search centring/highlighting the right node; a theme toggle repainting without
  moving nodes; the parse-error path surfacing in the panel status for a bad file; and the load→teardown→load
  cycle leaving no orphaned Web Worker (the lifecycle the review's worker-leak fix depends on).

It is filed as backlog rather than done inline because it requires a headless-browser harness that is not
reliably runnable inside the ticket agent — it belongs in CI or on a human's machine. Decide where the
harness lives (a new `test:browser` script in the `tallysim-viewer` workspace, wired into CI) as part of the
work, and update `docs/design.md` § Testing once it exists (it currently records this as explicitly deferred).
