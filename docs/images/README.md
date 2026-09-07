# Taleus — brand images

Logo exploration and the source art the app icon is generated from.

| File | What |
|------|------|
| `logo1.png`, `logo2.png`, `logo.svg`, `logo3.svg` | Earlier concepts (handshake + tally stick). Superseded. |
| `logo4.png` | Chosen concept (raster, 1254²): an indigo diamond with two hands passing a notched **tally stick** — the split-tally handover between stock and foil, cut in negative space. |
| **`logo4.svg`** | **Canonical** vector: `potrace` trace of `logo4.png` (trimmed to the mark, fill `#5736D0`, viewBox-only sizing). The trace is clean enough to use as-is; the app icon + in-app logo are generated from it. |

## Generating app assets

The hands and stick are negative space *through* the diamond, so the icon is the whole
diamond on a light background square (not a "white mark on indigo"). Regenerate with:

```bash
cd ../../packages/taleus-app/apps/mobile
npm run icons:android    # scripts/logo-gen-android.sh  → adaptive + legacy launcher icons, in-app logo.png
npm run icons:ios        # scripts/logo-gen-ios.sh      → ios AppIcon.appiconset
```

Both read `logo4.svg` from here. Background colour and mark scale are variables at the
top of each script. The diamond's tips sit on the icon's axes, so they are the first
thing a circular launcher mask clips — keep the scale where the render check passes.
