description: Rework the network viewer's interface to match the user-experience spec, so a first-time user can generate a network, watch a payment search and settle, and read sweep results without help.
prereq: tallysim-viewer-ux-spec
files: packages/tallysim-viewer/, packages/tallysim-viewer/docs/ux.md, packages/tallysim-viewer/docs/design.md
difficulty: hard
----

Implement `packages/tallysim-viewer/docs/ux.md` (from `tallysim-viewer-ux-spec`) in priority order, in tess as normal. When planning, split it along the spec's priority list. Keep the headless core unit-tested, and keep rendering changes behind it. Before closing, hand the developer a short, click-level checklist to drive the result (run one command, choose a named sample, press a named button, what they should see; no file editing or CLI work). The browser-only pieces can't be checked by a headless agent; `debt-viewer-consensus-visual-qa` shows the shape.
