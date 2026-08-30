# Custom LAN Stream Deck — Full Build Plan

## 1. What you're building

Two apps that talk to each other over your home WiFi:

- **Desktop Companion App** — installed on Ubuntu, Windows, and macOS. Runs quietly, listens on the LAN, and actually *does* things: opens apps, opens URLs.
- **Mobile PWA (the "deck")** — installable on your phone's home screen, no app store needed. Shows a customizable glassmorphism grid of buttons. Tapping a button sends a command over WiFi to the desktop app.

They never touch the internet — just your local network, so it stays fast and private.

```
┌─────────────────────┐         WiFi / LAN          ┌──────────────────────┐
│   Mobile PWA         │  ───────────────────────▶  │  Desktop Companion    │
│  (buttons, pages,    │   WebSocket (ws://)         │  (Ubuntu/Win/Mac)      │
│   grid, background)  │  ◀───────────────────────  │  - opens apps          │
└─────────────────────┘   ack / status / pong        │  - opens URLs          │
                                                       │  - serves icon uploads │
                                                       └──────────────────────┘
```

---

## 2. Tech stack recommendation

| Piece | Choice | Why |
|---|---|---|
| Desktop app shell | **Electron** (Node.js) | One codebase → Ubuntu `.deb`/AppImage, Windows `.exe`, macOS `.dmg`. Runs a background server + tray icon. |
| Desktop → OS actions | Node `child_process.exec` (Linux: `xdg-open`/`gtk-launch`, Windows: `start`, macOS: `open`) + the `open` npm package for URLs | Native, no extra runtime needed. |
| Local server | Node `ws` (WebSocket) + small Express HTTP server for icon/image uploads | WebSocket = instant button presses, no polling. |
| Discovery | `bonjour-service` (mDNS) so the PWA can auto-find the desktop app on the LAN, with **manual IP + QR code pairing** as a fallback | Auto-discovery is nice; manual/QR is the reliable fallback that always works. |
| Mobile PWA | **Vite + React + TypeScript**, `vite-plugin-pwa` for installability/service worker | Fast, installable "Add to Home Screen," works offline for the UI shell. |
| PWA styling | Tailwind CSS + custom CSS variables for the glass effect | Matches the glassmorphism look cleanly, easy to theme. |
| Drag/reorder grid | `@dnd-kit/core` | Smooth touch-friendly reordering of buttons. |
| State/config storage | Config lives on the **desktop app** (source of truth, as JSON) and syncs to the PWA on connect; PWA also caches locally via IndexedDB for instant load | Keeps multiple phones/devices in sync with one deck config. |
| Icons | User-uploaded images stored on the desktop app, served over HTTP to the PWA | Avoids bloating the PWA's own storage. |

---

## 3. Feature checklist (mapped to what you asked for)

- ✅ Open desktop apps from a button → desktop app resolves an "app id" (path/command) per OS
- ✅ Open URLs from a button → desktop app calls `open(url)`
- ✅ Custom icon images per button → upload/pick image, stored + referenced by URL
- ✅ Custom background (per page or global) → image or gradient, stored in config
- ✅ Multiple pages, back/forward navigation → paged deck with left/right swipe + arrow buttons, breadcrumb dots
- ✅ Choose grid layout (e.g. 3×3, 4×5, custom rows×cols) → per-page grid size setting
- ✅ Choose portrait or landscape → CSS layout responds to orientation; user can lock preference
- ✅ Runs from mobile as a PWA → installable, works like a native app icon
- ✅ Desktop app on Ubuntu, Windows, macOS → single Electron codebase, packaged per OS
- ✅ LAN-only connection, same WiFi → WebSocket over local IP, no cloud/internet dependency
- ✅ Glassmorphism design → frosted-glass buttons/panels over a blurred background

---

## 4. Communication protocol (the contract between the two apps)

**Pairing (first-time setup):**
1. Desktop app shows a QR code (or plain IP:port + 6-digit pairing code) in its tray window.
2. PWA scans the QR (or you type the IP) → opens `ws://<desktop-ip>:8787/deck`.
3. Desktop app confirms the pairing code, then sends the current deck config.

**Message shapes (JSON over WebSocket):**

```jsonc
// PWA → Desktop: button pressed
{ "type": "trigger", "buttonId": "btn_042" }

// Desktop → PWA: full config sync (on connect, or after edits)
{ "type": "config_sync", "pages": [ /* pages, buttons, layout, backgrounds */ ] }

// PWA → Desktop: create/edit a button (icon, action, position)
{ "type": "button_update", "pageId": "p1", "button": { "id": "btn_042", "icon": "icons/spotify.png", "action": { "kind": "open_app", "target": "spotify" } } }

// Desktop → PWA: result of a trigger (so the UI can show success/fail toast)
{ "type": "trigger_result", "buttonId": "btn_042", "ok": true }

// heartbeat both ways
{ "type": "ping" } / { "type": "pong" }
```

**Config data model (stored as JSON on the desktop app):**

```jsonc
{
  "pages": [
    {
      "id": "p1",
      "name": "Main",
      "grid": { "cols": 4, "rows": 5 },
      "background": { "type": "image", "value": "backgrounds/space.jpg" },
      "buttons": [
        {
          "id": "btn_001",
          "position": { "row": 0, "col": 0 },
          "label": "Spotify",
          "icon": "icons/spotify.png",
          "action": { "kind": "open_app", "target": "spotify" }
        },
        {
          "id": "btn_002",
          "position": { "row": 0, "col": 1 },
          "label": "GitHub",
          "icon": "icons/github.png",
          "action": { "kind": "open_url", "target": "https://github.com" }
        }
      ]
    }
  ],
  "layoutPreference": "auto"  // "portrait" | "landscape" | "auto"
}
```

---

## 5. Desktop app: launching things per OS

| OS | Open an app | Open a URL |
|---|---|---|
| Ubuntu/Linux | `gtk-launch <desktop-file-id>` or `xdg-open <path>`, or store the exact shell command per app (most reliable) | `xdg-open <url>` |
| Windows | `start "" "<path-to-exe>"` | `start "" "<url>"` |
| macOS | `open -a "<AppName>"` | `open "<url>"` |

Practical approach: when the user adds a button in "open app" mode, let them either **browse to the executable/`.desktop` file** or **pick from a list of installed apps** the desktop app detects — then store the resolved launch command per OS, so the button "just works" without guessing.

---

## 6. Glassmorphism design spec

- **Background:** full-bleed image or gradient per page, slightly blurred/darkened so buttons stay legible.
- **Button panels:** `background: rgba(255,255,255,0.12)`, `backdrop-filter: blur(16px)`, `border: 1px solid rgba(255,255,255,0.25)`, `border-radius: 20px`, soft outer shadow.
- **Press state:** scale down slightly (0.96) + brighten border on tap, haptic feedback via the Vibration API if available.
- **Typography:** clean sans-serif (Inter/SF Pro), labels under icons, small and slightly translucent.
- **Navigation:** page dots at the bottom, swipe left/right + optional on-screen back/forward chevrons.
- **Grid picker:** a settings panel with a rows × cols stepper (e.g. 3–6 range each) that live-previews the grid.
- **Orientation:** CSS grid recalculates button size to fill the viewport in both portrait and landscape; a settings toggle can lock one orientation.

---

## 7. Security notes (LAN-only, but still worth doing right)

- Bind the WebSocket/HTTP server to the LAN interface only, not `0.0.0.0` on public networks — detect network type where possible.
- Require the one-time pairing code on first connect; after that, remember trusted devices by a generated device token.
- Optional: simple on/off toggle in the desktop app to "allow new pairings," so no one can join without you actively approving it.

---

## 8. Suggested repo structure

```
streamdeck/
├── desktop-app/            # Electron app
│   ├── src/main/           # tray icon, WS server, OS launch logic
│   ├── src/renderer/       # small settings/pairing window
│   └── package.json
├── mobile-pwa/              # Vite + React PWA
│   ├── src/components/      # Grid, Button, PageNav, Settings, BackgroundPicker
│   ├── src/state/           # WebSocket client, config store
│   └── vite.config.ts
└── shared/
    └── protocol.ts          # shared TypeScript types for messages/config
```

---

## 9. Build order (phases)

1. **Phase 1 — Core loop:** Desktop app with hardcoded WS server + one hardcoded button that opens a URL. PWA with one button that sends the trigger. Prove the LAN round-trip works.
2. **Phase 2 — Config & pairing:** JSON config on desktop, QR/manual pairing, config sync to PWA.
3. **Phase 3 — Editor:** Add/edit/delete buttons in the PWA (icon upload, pick app/URL action), drag-to-reorder.
4. **Phase 4 — Pages & navigation:** Multiple pages, back/forward, page dots, per-page background.
5. **Phase 5 — Layout & design:** Grid size picker, portrait/landscape handling, full glassmorphism pass.
6. **Phase 6 — Packaging:** Electron builds for Ubuntu/Windows/macOS, PWA manifest + icons for install prompts, auto-discovery polish.

---

## 10. Full prompt for your AI coding agent

Copy everything in the box below into Claude Code (or another agentic coding tool) to start the build.

```
I'm building "LAN Stream Deck": a personal remote-control system with two apps that
communicate over my local WiFi network only (no internet/cloud).

PROJECT 1 — desktop-app (Electron, Node.js/TypeScript)
- Runs as a background app with a system tray icon on Ubuntu, Windows, and macOS.
- Starts a local WebSocket server (port 8787) and a small HTTP server for serving
  uploaded icon/background images.
- Stores a JSON config on disk: pages -> buttons -> {id, label, icon, position,
  action: {kind: "open_app"|"open_url", target}}.
- On "open_app", resolves and runs the correct OS-specific launch command
  (xdg-open/gtk-launch on Linux, `start` on Windows, `open` on macOS).
- On "open_url", opens the URL in the default browser per OS.
- Implements first-time pairing: generates a 6-digit code and a QR code (encoding
  ws://<lan-ip>:8787/deck plus the code) shown in a small tray window.
- Broadcasts config_sync to connected clients on connect and whenever config changes.
- Exposes simple endpoints/messages to create/update/delete pages and buttons, and to
  upload icon/background images.

PROJECT 2 — mobile-pwa (Vite + React + TypeScript, installable PWA)
- Installable PWA (manifest.json, service worker via vite-plugin-pwa) so it can be
  added to a phone's home screen and launched full-screen.
- On first launch: scan/enter the desktop app's pairing info, connect via WebSocket.
- Main screen: a grid of glassmorphism buttons (frosted glass panels, blurred custom
  background image, rounded corners, subtle press animation) laid out per the current
  page's grid config (user-adjustable rows x cols).
- Tapping a button sends {type:"trigger", buttonId} over the WebSocket and shows a
  brief success/error toast based on the trigger_result response.
- Multiple pages with swipe left/right navigation plus visible back/forward chevrons
  and page-indicator dots.
- Settings panel: choose grid size (rows/cols), choose background image or gradient
  per page, toggle portrait/landscape/auto layout, add/edit/delete buttons (upload an
  icon image, set label, choose action type "Open App" or "Open URL" and its target),
  drag-and-drop to reorder buttons within a page.
- All state is driven by config_sync from the desktop app, cached locally
  (IndexedDB) so the last-known layout shows instantly on open even before the
  WebSocket reconnects.
- Reconnect logic: if the WebSocket drops, retry with backoff and show a small
  "reconnecting..." indicator instead of blocking the UI.

SHARED
- Put shared TypeScript types (message schema, config schema) in a shared/ folder
  imported by both projects.
- Keep everything LAN-only: no external API calls, no analytics, no cloud storage.

Build this in phases, starting with: (1) a minimal WebSocket round trip — one
hardcoded button in the PWA that triggers one hardcoded "open URL" action on the
desktop app — before adding config editing, pairing UI, multiple pages, or the full
glassmorphism styling. Ask me before starting each new phase.
```

---

### A note on scope

This is a real multi-week project if you want it polished (packaging for three desktop OSes plus a full PWA editor is the bulk of the work). The phased prompt above is written so your AI agent builds and tests the core WiFi round-trip first, then layers on the editor, pages, and visual polish — so you always have something working rather than a big-bang build that might not connect at the end.
