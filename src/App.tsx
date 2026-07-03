import { useEffect, useMemo, useState } from "react";
import { Check, Crosshair, Keyboard, RotateCcw } from "lucide-react";
import {
  DEFAULT_SHORTCUT,
  getShortcut,
  registerShortcut,
  setShortcut,
  startCapture,
} from "./logic/shortcut";
import ScreenshotWindow from "./windows/Screenshot";
import "./App.css";

const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "Meta",
  "Shift",
  "Super",
]);

function normalizeKey(key: string) {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;

  const aliases: Record<string, string> = {
    " ": "Space",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    Escape: "Esc",
  };

  return aliases[key] || key;
}

function keyFromPhysicalCode(code: string) {
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return letter[1];

  const digit = code.match(/^Digit([0-9])$/);
  if (digit) return digit[1];

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  const aliases: Record<string, string> = {
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Escape: "Esc",
    Home: "Home",
    Insert: "Insert",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Space: "Space",
    Tab: "Tab",
  };

  return aliases[code] || null;
}

function shortcutKeyFromEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  return keyFromPhysicalCode(event.code) || normalizeKey(event.key);
}

function shortcutFromEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  if (MODIFIER_KEYS.has(event.key)) return null;

  const key = shortcutKeyFromEvent(event);
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);

  return parts.length > 1 ? parts.join("+") : null;
}

function formatShortcut(shortcut: string) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const keyNames: Record<string, string> = {
    Alt: isMac ? "Option" : "Alt",
    CommandOrControl: isMac ? "Cmd" : "Ctrl",
  };

  return shortcut
    .split("+")
    .map((part) => keyNames[part] || part)
    .join(" + ");
}

function App() {
  const path = window.location.pathname;
  console.log("Current path:", path);

  if (path === "/screenshot") {
    return <ScreenshotWindow />;
  }

  // 主窗口逻辑（通常隐藏在托盘）
  useEffect(() => {
    registerShortcut();
  }, []);

  const [shortcut, setShortcutValue] = useState(getShortcut);
  const [draftShortcut, setDraftShortcut] = useState(getShortcut);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("");
  const displayShortcut = useMemo(() => formatShortcut(shortcut), [shortcut]);

  const saveShortcut = async () => {
    if (!draftShortcut) return;

    try {
      await setShortcut(draftShortcut);
      setShortcutValue(draftShortcut);
      setStatus("Saved");
      setIsRecording(false);
    } catch {
      setStatus("Shortcut unavailable");
    }
  };

  const resetShortcut = async () => {
    setDraftShortcut(DEFAULT_SHORTCUT);
    try {
      await setShortcut(DEFAULT_SHORTCUT);
      setShortcutValue(DEFAULT_SHORTCUT);
      setStatus("Reset");
      setIsRecording(false);
    } catch {
      setStatus("Shortcut unavailable");
    }
  };

  return (
    <main className="settings-shell">
      <div className="settings-panel">
        <div className="settings-header">
          <div className="brand">
            <img
              className="brand-logo"
              src="/logo.png"
              alt=""
              aria-hidden="true"
            />
            <div className="brand-copy">
              <h1>xshot</h1>
              <p className="shortcut-pill">
                <Keyboard size={13} />
                <span>{displayShortcut}</span>
              </p>
            </div>
          </div>
          <button
            className="capture-button"
            type="button"
            onClick={() => startCapture()}
            title="Start capture"
          >
            <Crosshair size={18} />
            <span>Capture</span>
          </button>
        </div>

        <section className="settings-section">
          <div className="section-heading">
            <label htmlFor="shortcut-input">Shortcut</label>
            <span
              className={
                isRecording
                  ? "recording-indicator active"
                  : "recording-indicator"
              }
            >
              {isRecording ? "Recording" : "Ready"}
            </span>
          </div>
          <div className="shortcut-row">
            <div
              className={
                isRecording
                  ? "shortcut-input-wrap is-recording"
                  : "shortcut-input-wrap"
              }
            >
              <Keyboard size={18} />
              <input
                id="shortcut-input"
                value={formatShortcut(draftShortcut)}
                readOnly
                onFocus={() => setIsRecording(true)}
                onKeyDown={(event) => {
                  event.preventDefault();
                  const nextShortcut = shortcutFromEvent(event);
                  if (nextShortcut) {
                    setDraftShortcut(nextShortcut);
                    setStatus("");
                  }
                }}
                placeholder={isRecording ? "Press shortcut" : ""}
              />
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={saveShortcut}
              title="Save shortcut"
            >
              <Check size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={resetShortcut}
              title="Reset shortcut"
            >
              <RotateCcw size={18} />
            </button>
          </div>
          {status && <p className="settings-status">{status}</p>}
        </section>
      </div>
    </main>
  );
}

export default App;
