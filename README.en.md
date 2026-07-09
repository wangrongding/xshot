# xshot

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a> |
  <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="./public/logo-full.png" alt="xshot" width="360" />
</p>

<p align="center">
  <strong>Lightweight, tray-first desktop screenshot tool.</strong>
</p>

xshot is a desktop screenshot tool for quick capture, window/region selection, annotation, scrolling capture, crop, pin-to-screen, clipboard copy, and PNG saving. It is designed to be used from the tray and a global shortcut.

## Documentation Languages

The Simplified Chinese README is the source of truth for documentation. When feature descriptions, installation notes, limitations, or the roadmap change, update `README.md` first and then sync the English, Traditional Chinese, Japanese, Korean, Spanish, French, German, Brazilian Portuguese, and Russian versions.

## Core Features

- ✅ Supports scrolling capture.
- ✅ Supports pinning capture results as always-on-top floating windows.
- ✅ Supports OCR text recognition, QR recognition, text translation, and translation overlay.
- ✅ Supports annotation tools: number marker, arrow, rectangle, line, text, pen, eraser, and mosaic area.
- ✅ Supports window hover detection: move over a candidate window and click to select it.
- ✅ Supports visible and hidden watermarks: exported captures can add transparent text or embed a detectable frequency-domain watermark.

![screenshot/xshot.jpeg](./screenshot/xshot.jpeg)

## Usage

After launch, xshot runs from the tray. You can start a capture by:

- Pressing the default shortcut `Option + X` / `Alt + X`.

## Platform Notes

- If macOS says the developer cannot be verified, open `System Settings` -> `Privacy & Security` and choose `Open Anyway`.
- If the app still cannot be opened, run `xattr -dr com.apple.quarantine /Applications/xshot.app` and try again.
- On macOS, the first capture may require Screen Recording permission; restart the app after granting it.
- On macOS, scrolling capture requires Accessibility permission to monitor/filter wheel events and let the window under the selection receive scrolling.
- OCR uses macOS Vision; translation requires network access and uses Google Translate by default.
- Dock icon visibility is macOS-only.
- The current capture path targets the primary display. Multi-monitor support is still being improved.
- Window hover detection depends on system window enumeration, so some system windows, overlays, or fullscreen apps may behave differently.

## Settings

- Shortcut: enter a new key combination and save it to apply immediately.
- Reset shortcut: restore the default `Option + X` / `Alt + X`.
- Dock icon: macOS-only option for showing the app in the Dock.
- Launch at login: start xshot automatically after sign-in.
- Default save location: downloaded screenshots are saved here first; otherwise Downloads is used.
- Visible watermark: adds custom transparent text when copying, downloading, or pinning a capture; supports corners, horizontal tiling, and diagonal tiling.
- Hidden watermark: embeds custom watermark text when copying, downloading, or pinning a capture. The Settings page can detect hidden watermarks from an image; long detected text is shown in full on hover only when truncated.
- Interface language: currently supports Simplified Chinese and English.
- Permissions: on macOS, view Screen Recording and Accessibility authorization status and open the matching System Settings pane.

## Current Capture Pipeline

- The app creates and hides the screenshot WebView on startup, then reuses it when a capture starts.
- On macOS, regular capture currently uses system `screencapture -x -R <screenshot-window-rect>`; the result is written to a temporary PNG and then loaded into the frontend editing layer.
- On Windows / Linux, the current path captures the display through `xcap` and encodes PNG in Rust.
- On macOS, scrolling capture makes the screenshot window mouse-transparent and only passes downward wheel events through. Frames are captured with CoreGraphics `CGWindowListCreateImage` below the screenshot window, with `screencapture -R` as fallback.
- Scrolling capture stitches by estimating the real vertical offset between frames and appending only the new rows. Tiny shifts do not update the previous frame, which avoids over-appending on repeated textures or blank areas.
- After rendering, long screenshots enter the crop/edit view; copy and save export the current crop.
- Pinning writes the current exported PNG to a temporary directory, then creates a borderless, always-on-top, all-workspaces Tauri window to display it.
- Watermarks are applied only at final export time and cover copy, download, and pin-to-screen. OCR, QR recognition, and translation still use the original selection to avoid watermark interference.
- The hidden watermark main path embeds bits into 8x8 DCT luminance mid-frequency coefficient pairs, repeats the header and body, and restores bits by majority vote during detection. The payload includes magic, length, and checksum; the old LSB path remains as a compatibility fallback for small images and older exports.
- OCR uses macOS Vision `VNRecognizeTextRequest`, preferring accurate recognition and falling back to fast recognition; QR detection uses `VNDetectBarcodesRequest`.
- Translation is handled by the Rust backend through Google Translate and supports system proxy settings. Translation overlay creates editable, undoable text annotations from OCR block coordinates; clicking the overlay tool again removes the generated overlay.
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
src/logic/watermark.ts  Visible watermark rendering, hidden watermark embedding and detection
src-tauri/              Tauri / Rust backend
src-tauri/src/lib.rs    Capture, tray, clipboard, command registration
src-tauri/src/ocr.rs    macOS Vision OCR / QR recognition
src-tauri/src/translation.rs  Translation service
public/                 Image assets
```

## Current Limitations

- Multi-monitor support is still incomplete.
- Scrolling capture is currently macOS-first and depends on Screen Recording and Accessibility permissions. It currently supports downward stitching only.
- OCR is currently macOS-first; translation depends on network access and Google Translate availability.
- Annotation property edits are applied immediately but are not yet tracked as standalone undo actions.
- Hidden watermarking is for lightweight tracing and detection, not DRM or tamper prevention. Same-size PNG/JPEG/WebP re-encoding is more robust than the old LSB path, but heavy resizing, cropping, rotation, strong compression, filters, or secondary screenshots may still break detection.
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
