# xshot

<p align="center">
  <a href="./README.md">简体中文</a> | <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img src="./public/logo-full.png" alt="xshot" width="360" />
</p>

<p align="center">
  <strong>Lightweight, tray-first desktop screenshot tool.</strong>
</p>

xshot is a desktop screenshot tool for quick capture, window/region selection, annotation, scrolling capture, crop, clipboard copy, and PNG saving. It is designed to be used from the tray and a global shortcut.

## Core Features

- Tray-first app behavior; the main window is hidden by default.
- Global screenshot shortcut, default:
  - macOS: `Option + X`
  - Windows / Linux: `Alt + X`
- Main window settings for shortcut, Dock icon, launch at login, default save location, language, and macOS permission entry points.
- Window hover detection: move over a candidate window and click to select that window region.
- Manual region selection with move and corner resize controls.
- Manual downward scrolling capture: capture the selected region frame by frame, stitch automatically, and preview live.
- Long screenshots can be cropped after rendering before copying or saving.
- Selection-following toolbar with copy-to-clipboard and PNG download actions, positioned away from the top safe area.
- Built-in Simplified Chinese and English UI.

## Annotation Tools

- Number marker
- Arrow
- Rectangle
- Line
- Text
- Pen
- Eraser
- Mosaic area

Tool properties such as color, stroke width, and text size live in a secondary panel attached to the corresponding tool button. Clicking an existing annotation selects it first; selected annotations can be moved and edited through the matching tool panel. Clicking an empty area inside the selection creates a new annotation.

## Usage

After launch, xshot runs from the tray. You can start a capture by:

- Pressing the default shortcut `Option + X` / `Alt + X`.
- Clicking the `Capture` button in the main window.
- Choosing `Capture` from the tray menu.

During capture:

- Move over a window and click the highlighted candidate to select that window.
- Drag anywhere to create a custom region.
- After the region is ready, the toolbar appears near the selection.
- Click an annotation tool, then click an empty area inside the selection to create an annotation; clicking an existing annotation selects it first.
- Click the scrolling capture button to show the floating preview panel beside the selection. Scroll downward inside the selection; after scrolling settles, xshot samples and stitches automatically. Reverse and horizontal scrolling are ignored to avoid corrupting the stitch.
- The scrolling capture panel only shows live preview and shortcuts: `Enter` renders the long screenshot, `Esc` cancels.
- After rendering, the long screenshot returns to the editor. Resize the selection handles to crop it; copy and download export the current crop.
- `Enter` or the confirm button copies the current capture/crop to the clipboard.
- The download button saves a PNG.
- `Esc` or the close button cancels the capture.

## Settings

- Shortcut: enter a new key combination and save it to apply immediately.
- Reset shortcut: restore the default `Option + X` / `Alt + X`.
- Dock icon: macOS-only option for showing the app in the Dock.
- Launch at login: start xshot automatically after sign-in.
- Default save location: downloaded screenshots are saved here first; otherwise Downloads is used.
- Language: Simplified Chinese and English.
- Permissions: on macOS, view Screen Recording and Accessibility authorization status and open the matching System Settings pane.

## Platform Notes

- On macOS, the first capture may require Screen Recording permission; restart the app after granting it.
- On macOS, scrolling capture requires Accessibility permission to monitor/filter wheel events and let the window under the selection receive scrolling.
- Dock icon visibility is macOS-only.
- The current capture path targets the primary display. Multi-monitor support is still being improved.
- Window hover detection depends on system window enumeration, so some system windows, overlays, or fullscreen apps may behave differently.

## Current Capture Pipeline

- The app creates and hides the screenshot WebView on startup, then reuses it when a capture starts.
- On macOS, regular capture currently uses system `screencapture -x -R <screenshot-window-rect>`; the result is written to a temporary PNG and then loaded into the frontend editing layer.
- On Windows / Linux, the current path captures the display through `xcap` and encodes PNG in Rust.
- On macOS, scrolling capture makes the screenshot window mouse-transparent and only passes downward wheel events through. Frames are captured with CoreGraphics `CGWindowListCreateImage` below the screenshot window, with `screencapture -R` as fallback.
- Scrolling capture stitches by estimating the real vertical offset between frames and appending only the new rows. Tiny shifts do not update the previous frame, which avoids over-appending on repeated textures or blank areas.
- After rendering, long screenshots enter the crop/edit view; copy and save export the current crop.
- Capture timing logs are intentionally kept to profile shortcut handling, screen capture, image decoding, and window presentation.
- ScreenCaptureKit was tested earlier, but the quality and latency tradeoff was not good enough for the main path, so the stable fallback remains the default.

## Development

Tauri prerequisites: <https://v2.tauri.app/start/prerequisites/>

Requirements:

- Node.js
- pnpm
- Rust
- Tauri v2 system dependencies

Useful commands:

```bash
pnpm install       # Install dependencies
pnpm dev           # Start Tauri development mode
pnpm dev:web       # Start Vite only
pnpm build:web     # Build frontend
pnpm build         # Build desktop app
pnpm tsc           # TypeScript check
pnpm format        # Prettier + cargo fmt
```

Project structure:

```text
src/                    React frontend
src/windows/            Screenshot window
src/logic/              Settings, shortcuts, cursor helpers
src-tauri/              Tauri / Rust backend
src-tauri/src/lib.rs    Capture, tray, clipboard, window commands
public/                 Image assets
```

## Current Limitations

- Multi-monitor support is still incomplete.
- Scrolling capture is currently macOS-first and depends on Screen Recording and Accessibility permissions. It currently supports downward stitching only.
- Annotation property edits are applied immediately but are not yet tracked as standalone undo actions.
- Advanced settings such as image format selection, launch options, and toolbar customization are not exposed yet.
- Window capture depends on candidate window detection; a few transparent windows, system overlays, or fullscreen spaces may not be matched accurately.

## Roadmap

- Complete multi-monitor capture and coordinate mapping.
- Add image format and quality settings.
- Track annotation property edits in a more complete undo/redo stack.
- Support more annotation styles and toolbar configuration.
- Improve packaging, release flow, and platform compatibility checks.

## Tech Stack

- Tauri v2
- React 19
- TypeScript
- Vite
- Fabric.js
- lucide-react
- i18next / react-i18next
- xcap / image
- Tauri autostart / dialog / global-shortcut / clipboard-manager / opener plugins
- ai-ins Vite plugin
