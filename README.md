<p align="center">
  <img src="docs/images/logo.png" width="96" alt="jn-clipboard" />
</p>

<h1 align="center">jn-clipboard</h1>

<p align="center"><b>What you copy, on every machine you use.</b></p>

<p align="center">
  <a href="https://github.com/JNNarrator/jn-clipboard/releases"><img src="https://img.shields.io/github/v/release/JNNarrator/jn-clipboard?label=VERSION&style=for-the-badge&color=2196F3" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-GPL--3.0-FF9800?style=for-the-badge" alt="License" /></a>
  <img src="https://img.shields.io/badge/PLATFORM-macOS%20%7C%20Windows%20%7C%20Web-43A047?style=for-the-badge" alt="macOS, Windows and the web" />
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

---

`jn-clipboard` keeps what you copy — text, rich text, images and file paths — in a
local database and puts it back on the clipboard the moment you need it. It is one
application in three shapes: a menu-bar app on macOS, a tray app on Windows, and
an installable web app that lives on your phone's home screen.

All three share one interface and, through a self-hosted backend, one history:
copy on the desktop, paste on the phone — usually before you've switched apps.

---

## Why this one

- **Everything travels, including images.** Screenshots are stored once by content
  digest and streamed to whichever device opens them — a pin or a tag edit never
  re-uploads the bytes.
- **Deletes stay deleted.** A delete is a tombstone that wins over concurrent
  edits from an offline device; a clip you removed does not come back when an old
  laptop catches up.
- **Duplicates resolve themselves.** Copy the same text on two devices and they
  converge to one entry, using a deterministic rule every device agrees on without
  talking to each other.
- **Near-instant propagation.** Desktop clients hold a live change stream to the
  server; the web build probes a one-number endpoint. Sync latency is one network
  round trip, not a polling interval.
- **Local first, private by design.** The database is SQLite/IndexedDB on your own
  disk. Nothing leaves the device until you sign in to a server you host, and
  sensitive entries stay encrypted at rest on each device.

---

## Features

| | |
| :--- | :--- |
| **Capture** | Text, rich text (HTML), images and file paths, collected automatically. Duplicates collapse into one entry, and per-app rules can ignore an app or rewrite what it contributes. |
| **Find** | Full-text search, plus filters by content type, source app, tag and date. Pinned entries stay on top. |
| **Paste** | One keystroke pastes straight into the app you came from. Or copy without pasting, paste as plain text, or queue several entries and paste them in order. |
| **Organize** | Multi-colour tags, pinning with a manual order, and a note on any entry. |
| **Look** | Three native-material themes — Mica and Acrylic on Windows, macOS vibrancy on macOS — each in light and dark. Edge docking, a compact preview window, and a resizable panel. |
| **Privacy** | IDs, phone numbers and e-mail addresses are masked in previews. Sensitive entries are encrypted at rest with a device-local key. Nothing is sent anywhere by default. |
| **Sync** | A JNClub account against a backend you host: history, tags, notes, pins — and images — across macOS, Windows and the web. |
| **Updates** | Checks for new releases on launch and on demand; the update feed carries a fallback mirror for networks where GitHub is unreachable. |

---

## Install

| Platform | Requirement | Download |
| :--- | :--- | :--- |
| **macOS** | 10.13 or newer, Apple Silicon or Intel | `.dmg` / `.app` |
| **Windows** | 10 or newer, x64 | `.exe` installer, `.msi`, or a portable `.zip` |
| **Browser** | Any current browser; installable as a PWA | [jiangnan.88933.vip/clipboard](https://jiangnan.88933.vip/clipboard/) |

[**Download the latest release →**](https://github.com/JNNarrator/jn-clipboard/releases)

### First launch

The builds are ad-hoc signed but not notarized — there is no paid developer
certificate behind them, so macOS and Windows both refuse them at first.

On **macOS** the app is reported as unverified: open **System Settings → Privacy
& Security**, scroll down and press **Open Anyway**. Builds older than 1.0.2
report the app as *damaged* instead; repair one in place with:

```bash
xattr -dr com.apple.quarantine /Applications/jn-clipboard.app
codesign --force --deep --sign - /Applications/jn-clipboard.app
```

On **Windows** SmartScreen shows a warning: **More info → Run anyway**.

macOS then asks for **Accessibility** permission, which is what lets the app
paste into the frontmost application for you. If the switch is already on and
pasting still does not happen, macOS is holding a permission grant that belongs
to an older build — remove `jn-clipboard` from the Accessibility list and let the
app add itself again. Without the permission the app still copies; you just
press ⌘V yourself.

### Browser build

The web build runs the same UI on top of IndexedDB. A page cannot watch the
system clipboard, so it has a capture bar instead: paste or type, press
⌘/Ctrl+Enter. Everything else — search, tags, pinning, notes — behaves as it
does on the desktop, and with a JNClub account signed in it sees the same
history as your desktop, pictures included.

---

## Themes

Three themes ship with the app, and nothing else: they are the platform's own
materials rather than paint jobs. A theme only changes the window's translucency
and accent behaviour, so the layout you learn on one is the layout you get on
the others.

Earlier versions of this fork carried six cosmetic themes (paper, sticky note,
retro, terminal, receipt, ink). They were dropped — picking one is a matter of
taste, and keeping them meant maintaining six stylesheets for a feature that
paid for nothing in usability. A profile that still has one selected falls back
to the platform default on upgrade.

---

## Sync

Sync is optional and off until you sign in. When you do, it is **JNClub** —
sign in with a JNClub account and the desktop and web builds share one history
through a backend you host. The sign-in flow opens your browser, and the token
comes back to a loopback port the app is listening on for that one request.

What the protocol guarantees:

- **Server-assigned sequence numbers** drive incremental pull; a cursor never
  skips another device's writes, and every record carries a revision for
  optimistic locking.
- **Deletes are tombstones** and delete-wins: an edit racing a delete loses, so
  removing a clip is final on every device.
- **Duplicate copies merge deterministically** — earliest capture wins, ties
  break on the entry id, and the losing identity ships out as a tombstone — so
  all devices converge on the same single entry.
- **Attachments are content-addressed** by SHA-256 and reference-counted; a
  nightly sweep reclaims storage only after a week with zero references.
- **Device-private settings never travel.** Window sizes, cursors and tokens stay
  on the machine they belong to; usage counters are local, so pasting never
  triggers network traffic.
- **Sensitive entries** (tagged as such) are decrypted for transport over HTTPS
  to your own server and re-encrypted at rest on each device.

The server side is a module of [JNClub](https://github.com/JNNarrator) —
`jnclub-module-clipboard` — and needs to be reachable over HTTPS from every
device you sync. The legacy WebDAV engine was retired in 1.0.8; a build flag
(`VITE_WEBDAV_SYNC=1`) can still surface it for one-off migrations, but the UI
ships with JNClub sync only.

### A note on upgrades from ≤ 1.0.7

Older builds had a cursor bug that could permanently skip records written by
other devices while you were offline. Upgrading stops it from happening again;
if entries are already missing on a device, reset its sync cursor
(`jnclub.sync_last_seq` → `0` in the local database) with the app closed, and
the next sync re-pulls the full history — duplicates merge, known entries are
skipped, nothing is lost.

---

## Build from source

Requirements: Node 20 or newer (CI builds with 22), a stable Rust toolchain, and
the usual platform tooling — Xcode command line tools on macOS, MSVC plus WebView2
on Windows.

```bash
npm ci

npm run tauri:dev     # desktop app, hot reload
npm run tauri:build   # desktop bundle
npm run build         # desktop UI only        -> dist/web
npm run build:pwa     # browser build          -> dist/pwa (base path /clipboard/)
```

Checks:

```bash
npm test              # vitest: frontend units
npm run lint          # eslint
npm run lint:styles   # design-system rules for the stylesheets
npm run test:rust     # cargo test, including the Rust units and integration tests
npm run test:e2e      # browser end-to-end suite (needs its own npm ci in e2e/)
```

`npm run build:pwa` assumes the files are served from `/clipboard/` on the same
origin as the sync API, because the service worker, the session cookie and the
API all have to agree on an origin. Point `VITE_JNCLUB_BASE_URL` at the API when
it lives elsewhere, or move the base path with `VITE_BASE_PATH`.

Release builds are described in [docs/RELEASES.md](docs/RELEASES.md); the design
system the stylesheets are checked against is in
[docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).

---

## Project layout

```
src/                 React UI, shared by the desktop and browser builds
  features/          clipboard list, settings, tag manager
  shared/            hooks, platform abstraction, design tokens
  web/               browser-only: IndexedDB storage, sync engine, service worker
src-tauri/           Rust core and Tauri shell
  src/services/      clipboard capture, JNClub sync client
  src/infrastructure/ platform APIs (macOS panels, Windows hooks, storage)
e2e/                 Playwright suite that drives the real UI in a browser
```

The build target decides which backend the UI talks to: with `VITE_TARGET=web`
the `@tauri-apps/*` modules resolve to the implementations in `src/web/shims/`,
which dispatch commands into the IndexedDB backend instead of the Rust one.

---

## Privacy

No analytics, no telemetry, no identifiers sent anywhere. The only outbound
requests are the ones you turn on yourself — JNClub sync — plus the release
check, which happens once at launch and when you ask for it, and falls back to
a self-hosted mirror when GitHub cannot be reached.

---

## Credit and licence

`jn-clipboard` began as a fork of
[tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard) by jimuzhe, which is
licensed under the [GNU GPL-3.0](LICENSE). The design and a large part of the
implementation are that project's work; this fork keeps the same licence and the
upstream copyright notices.

Changes made here: the AI actions, MQTT code sync, LAN transfer, third-party
importers and emoji panel were removed, six cosmetic themes were dropped, the
built-in updater and the calls to the upstream announcement and theme-store
services were taken out, a check against this repository's GitHub releases
replaced them, and a browser/PWA build plus a self-hosted sync backend were
added — later hardened with a delete-wins protocol, deterministic dedupe,
content-addressed attachments and a live change stream.

If you want to support the original project, do it
[upstream](https://github.com/jimuzhe/tiez-clipboard).
