description: Add a 3D view to the network viewer that can orbit, pan and zoom, so large simulated networks (a developer found 2,000 nodes hard to read in 2D) can be explored by turning the cloud around.
prereq: tallysim-viewer-camera-controls
files: packages/tallysim-viewer/, packages/tallysim-viewer/docs/design.md
----

The viewer draws in 2D with sigma.js. At around 2,000 nodes the cloud is hard to read. A 3D force layout lets you rotate overlapping parts apart.

To plan:
- A second renderer (e.g. three.js through `3d-force-graph`, or a direct three.js scene) behind the same headless core: graph model, trace index, timeline and route state. Switch between 2D and 3D; replay, live runs and the consensus animation work in both.
- A 3D layout in the existing off-main-thread worker (e.g. d3-force-3d), seeded so the layout is reproducible.
- Picking edges and nodes, hovering, labels in 3D (labels for selected or nearby nodes only), and performance at 2k–10k nodes.
- What reads worse in 3D (precise picking, depth confusion) and whether 2D stays the default.
