description: Add a magnifying lens to the network viewer. Holding a key (e.g. Shift) shows a round lens around the cursor that enlarges what is inside it and squeezes what lies near its rim, so the inside joins up smoothly with the rest of the network.
prereq: tallysim-viewer-camera-controls
files: packages/tallysim-viewer/src/graph/render.ts, packages/tallysim-viewer/docs/design.md
----

Developer's idea (2026-11-25) for dense graphs: hold a key, and a round lens follows the cursor. Inside the radius things are magnified; a band around the ring is compressed, so edges stay continuous between inside and outside. This is a graphical fisheye (Sarkar–Brown) distortion.

To plan:
- Apply the distortion to displayed node positions only, never to the layout or the model (e.g. a sigma `nodeReducer` that remaps x/y relative to the cursor in viewport space). Edges follow their endpoints, which keeps them continuous.
- Distortion function: magnification inside, compression in a rim band, identity outside. Make radius and magnification adjustable (wheel while the key is held).
- Labels for nodes inside the lens; hover and pick through the lens (invert the mapping for hit tests).
- Performance at 2k+ nodes while the cursor moves (refresh only nodes near the lens).
- Whether it also suits the 3D view (`feat-tallysim-viewer-3d`), or is 2D only.
