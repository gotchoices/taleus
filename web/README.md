# Taleus — web

The public site for Taleus, served at **https://sereus.org/taleus/** (path-based on the
existing `sereus.org` host, so it reuses that site's TLS cert / vhost — no separate
subdomain to provision). Three jobs, mirroring `chat/web`:

1. **Learn** about Taleus and **download** the app (the landing page).
2. **Handle invitation links** for people who don't have the app yet
   (`/taleus/invite/<token>` → a "you're invited, get the app" page).
3. **Contribute the deep-link association entries** so
   `https://sereus.org/taleus/invite/…` opens the app directly on phones that have it
   (Android App Links / iOS Universal Links).

## Contents

| Path | What |
|------|------|
| `index.html`, `styles.css` | The landing page (indigo palette from `design/specs/mobile/global/ui.md`) |
| `invite.html` | Fallback shown at `/taleus/invite/<token>` when the app isn't installed |
| `images/logo.svg` | App-icon composite (peach tile + mark). The mark is pasted from the canonical [`docs/images/logo4.svg`](../docs/images/logo4.svg) |
| `.well-known/assetlinks.json` | Taleus's Android App-Links statement (merged into the apex on deploy) |
| `.well-known/apple-app-site-association` | Taleus's iOS Universal-Links detail (merged into the apex on deploy) |
| `server.sh` | Local preview (`./server.sh` → http://localhost:8080/taleus/) |
| `publish.sh` | Deploy to `sereus.org/taleus` (+ merge into the apex `.well-known`) |

The APK (`taleus.apk`) is **not** in this repo — it's built and published separately into
`sereus.org/taleus/`, so the `Download APK` link and `publish.sh`'s `--delete` leave it alone.

## Deep links (App Links / Universal Links) — and the apex `.well-known`

The app claims `https://sereus.org/taleus/invite/<token>` and nothing else on the host
(`design/specs/project.md`; `apps/mobile/android/app/src/main/AndroidManifest.xml`,
`src/navigation/linking.ts`).

App Links (Android) and Universal Links (iOS) only read the association files at the
**host root** — `https://sereus.org/.well-known/…`, never `…/taleus/.well-known/…`. That
root is **shared** with the other Sereus apps (chat, health), so this directory keeps only
*Taleus's own* entries in `.well-known/`, and `publish.sh` **merges** them into the apex
files by key (`package_name` for Android, bundle id for iOS) — it never overwrites or
`--delete`s the shared files.

Serving requirements for the apex files (`sereus.org/.well-known/`):
- Reachable over **HTTPS with a valid cert**, **no redirect**, **no auth**.
- `apple-app-site-association` served with **`Content-Type: application/json`** and
  **no file extension**.

Fill in before it will verify:

- **`assetlinks.json`** carries the repo's **debug** signing fingerprint (the stock React
  Native `debug.keystore`), so a debug build verifies as-is. Add the **release**
  fingerprint before shipping a release build:
  ```bash
  keytool -list -v -keystore <release.keystore> -alias <alias> | grep 'SHA256:'
  ```
- **`apple-app-site-association`** uses the Sereus Apple Team ID (same as chat). The iOS
  target does not yet carry an `applinks:sereus.org` entitlement — add
  `ios/mobile/mobile.entitlements` (copy chat's) and the **Associated Domains** capability in
  Xcode when iOS universal links are wired.

### `/taleus/invite/<token>` routing

For the browser fallback, the host must rewrite `/taleus/invite/*` to
`/taleus/invite.html` (which reads the token client-side). Example nginx:

```nginx
location /taleus/invite/ { try_files $uri /taleus/invite.html; }
```

Apache (`.htaccess` under the `taleus/` dir):

```apache
RewriteEngine On
RewriteRule ^invite/.*$ /taleus/invite.html [L]
```

The "Already installed? Open it" button tries `taleus://invite/<token>`; the app's
`linking.ts` does not map that path yet (`ReviewInvitation` is still to be generated), so
until it does the button launches the app at its initial route.

## Preview locally

```bash
./server.sh          # http://localhost:8080/taleus/
```

`http.server` does no rewriting, so preview the invite page directly at
`/taleus/invite.html?token=DEMO`.

## Publish

```bash
./publish.sh                                 # → root@gotchoices.org, /var/www/sereus.org
./publish.sh user@host /var/www/sereus.org   # override remote + sereus.org docroot
```

`publish.sh` rsyncs the page content into `sereus.org/taleus` (with `--delete`, scoped to
Taleus's own dir) and **merges** the `.well-known` entries into `sereus.org/.well-known/`
without touching other apps' entries. Requires ssh access to the host that serves
`sereus.org`.
