<p align="left">
  <img src="docs/images/logo.png" width="32" vertical-align="middle" />
  <b>Making fragmented information flow effortlessly.</b>
</p>

> **A fork.** `jn-clipboard` is a personal fork of
> [jimuzhe/tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard) by jimuzhe,
> used and distributed under the GNU GPL-3.0. The upstream project deserves the
> credit for the application this is built on.
>
> What changed here: the AI, MQTT sync, LAN transfer, third-party import and
> emoji features were removed, six cosmetic themes were dropped, the updater and
> the upstream announcement/theme-store calls were taken out so the app makes no
> unsolicited network requests, and a browser/PWA build was added that shares the
> same UI over IndexedDB.

---

<div align="center">
  <img src="docs/images/logo.png" alt="jn-clipboard Hero Logo" width="300" />

  ### **STAY FAST. STAY SYNCED.**

  | STARS | VERSION | LICENSE | PLATFORM |
  | :--- | :--- | :--- | :--- |
  | [![Version](https://img.shields.io/github/v/release/JNNarrator/jn-clipboard?label=VERSION&style=for-the-badge&color=2196F3)](https://github.com/JNNarrator/jn-clipboard/releases) | [![License](https://img.shields.io/badge/LICENSE-GPL--3.0-FF9800?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0) | [![Platform](https://img.shields.io/badge/PLATFORM-macOS%20%7C%20Windows%20%7C%20Web%20%2FPWA-f44336?style=for-the-badge)](https://github.com/JNNarrator/jn-clipboard) |

  [English](./README.md) | [简体中文](./README.zh-CN.md)
</div>

---

<div align="center">

## Theme Gallery

Three native-material themes — Mica and Acrylic on Windows, the macOS vibrancy
material on macOS — each with dark and light modes:

<div align="center">
  <table>
    <tr>
      <td align="center"><b>Frosted</b><br><img src="docs/images/毛玻璃.png" width="220" /></td>
    </tr>
  </table>
</div>

---

## Why jn-clipboard?

| Performance | Practicality | Privacy | Sync |
| :--- | :--- | :--- | :--- |
| **Instant Access**<br>Native listeners and Rust core ensure absolute speed. | **Power Workflows**<br>Rich text, tags, and instant actions. | **Local & Private**<br>Local-first storage with smart masking for sensitive data in previews. | **Cloud Fluent**<br>Seamless WebDAV cross-device sync. |

---

## Key Features

### Core Experience
- **Native Efficiency**: Built with Tauri 2 and Rust for minimum memory footprint.
- **Smart Capture**: Automatically collects text, rich text (HTML), images, and file paths.
- **Modern UI**: Supports Mica/Acrylic effects and Dark/Light modes with **3 native-material theme styles**.
- **Edge Docking**: Automatically hides at the screen edge to stay out of your way.

### Management & Enhancements
- **Tag System**: Organize your history with custom multi-color tags.
- **Advanced Settings**: Granular control over cleanup rules and app behavior.
- **Privacy Masking**: Auto-masks sensitive info like IDs and phone numbers in previews.

### Networking & Transport
- **WebDAV Sync**: Your data, your cloud. Complete cross-device history.
- **JNClub Sync**: Sign in with a JNClub account and the desktop and the browser
  copy talk to each other through the same history.

### Productivity Tools
- **Global Search**: Find anything by content, source app, or date.
- **Sequential Paste**: Optimized workflow for high-frequency copy-paste tasks.

---

## Installation

### Platform Support
| Platform | Requirement | Output |
| :--- | :--- | :--- |
| **macOS** | macOS 10.15+ <br>(Apple Silicon / Intel) | `.dmg` / `.app` |

[**Download the Latest Release →**](https://github.com/JNNarrator/jn-clipboard/releases)

### Browser build

The same UI also builds for the browser (installable as a PWA):

```
npm ci
npm run build          # desktop shell   -> dist/web
npm run build:pwa      # browser shell   -> dist/pwa   (base path /clipboard/)
```

`npm run build:pwa` assumes the files are served from `/clipboard/` on the same
origin as the sync API, because the service worker and the SSO cookie both want
a same-origin deployment. Point `VITE_JNCLUB_BASE_URL` at the API when it lives
elsewhere, or override the base path with `VITE_BASE_PATH`.

---

## Credit & License

`jn-clipboard` is a fork of [jimuzhe/tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard),
which is licensed under the [GNU GPL-3.0](LICENSE). This fork keeps that licence
and the upstream copyright notices; the modifications listed at the top of this
file are also covered by it.

If you want to support the original project, do that
[upstream](https://github.com/jimuzhe/tiez-clipboard), not here.

---

<div align="center">
  Built with technical precision for every efficient developer.
</div>
