import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  AppWindowMac,
  Check,
  Crosshair,
  FolderOpen,
  Keyboard,
  Languages,
  Power,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import {
  DEFAULT_SHORTCUT,
  getShortcut,
  registerShortcut,
  setShortcut,
  startCapture,
} from "./logic/shortcut";
import {
  getSettings,
  SUPPORTED_LANGUAGES,
  updateSettings,
  type AppSettings,
  type AppLanguage,
} from "./logic/settings";
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
  const { t, i18n } = useTranslation();
  const path = window.location.pathname;
  console.log("Current path:", path);

  if (path === "/screenshot") {
    return <ScreenshotWindow />;
  }

  // 主窗口逻辑（通常隐藏在托盘）
  useEffect(() => {
    registerShortcut();

    const initialSettings = getSettings();
    void invoke("set_dock_icon_visible", {
      visible: initialSettings.showDockIcon,
    }).catch((error) => {
      console.warn("Failed to apply Dock icon setting:", error);
    });

    void isEnabled()
      .then((enabled) => setAutoStart(enabled))
      .catch((error) => {
        console.warn("Failed to read autostart state:", error);
      });
  }, []);

  const [shortcut, setShortcutValue] = useState(getShortcut);
  const [draftShortcut, setDraftShortcut] = useState(getShortcut);
  const [settings, setSettings] = useState(getSettings);
  const [autoStart, setAutoStart] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("");
  const displayShortcut = useMemo(() => formatShortcut(shortcut), [shortcut]);
  const isMac = useMemo(
    () => navigator.platform.toLowerCase().includes("mac"),
    []
  );
  const saveDirectoryLabel =
    settings.defaultSaveDirectory || t("settings.defaultSaveDirectoryEmpty");

  const applySettings = (patch: Partial<AppSettings>) => {
    const nextSettings = updateSettings(patch);
    setSettings(nextSettings);
    return nextSettings;
  };

  const restoreSettings = (previousSettings: AppSettings) => {
    updateSettings(previousSettings);
    setSettings(previousSettings);
  };

  const saveShortcut = async () => {
    if (!draftShortcut) return;

    try {
      await setShortcut(draftShortcut);
      setShortcutValue(draftShortcut);
      setStatus(t("settings.status.saved"));
      setIsRecording(false);
    } catch {
      setStatus(t("settings.status.shortcutUnavailable"));
    }
  };

  const resetShortcut = async () => {
    setDraftShortcut(DEFAULT_SHORTCUT);
    try {
      await setShortcut(DEFAULT_SHORTCUT);
      setShortcutValue(DEFAULT_SHORTCUT);
      setStatus(t("settings.status.reset"));
      setIsRecording(false);
    } catch {
      setStatus(t("settings.status.shortcutUnavailable"));
    }
  };

  const handleDockIconChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const visible = event.currentTarget.checked;
    const previousSettings = settings;
    applySettings({ showDockIcon: visible });

    try {
      await invoke("set_dock_icon_visible", { visible });
      setStatus(t("settings.status.updated"));
    } catch {
      restoreSettings(previousSettings);
      setStatus(t("settings.status.updateFailed"));
    }
  };

  const handleAutoStartChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const enabled = event.currentTarget.checked;
    setAutoStart(enabled);

    try {
      if (enabled) await enable();
      else await disable();
      setAutoStart(await isEnabled());
      setStatus(t("settings.status.updated"));
    } catch {
      setAutoStart(!enabled);
      setStatus(t("settings.status.updateFailed"));
    }
  };

  const chooseSaveDirectory = async () => {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: t("settings.chooseSaveDirectory"),
    });

    if (typeof selectedPath !== "string") return;
    applySettings({ defaultSaveDirectory: selectedPath });
    setStatus(t("settings.status.pathSelected"));
  };

  const clearSaveDirectory = () => {
    applySettings({ defaultSaveDirectory: "" });
    setStatus(t("settings.status.pathCleared"));
  };

  const handleLanguageChange = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const language = event.currentTarget.value as AppLanguage;
    applySettings({ language });
    await i18n.changeLanguage(language);
    setStatus(i18n.t("settings.status.updated"));
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
              <h1>{t("settings.appName")}</h1>
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
            title={t("settings.captureTitle")}
          >
            <Crosshair size={18} />
            <span>{t("settings.capture")}</span>
          </button>
        </div>

        <section className="settings-section">
          <div className="section-heading">
            <label htmlFor="shortcut-input">{t("settings.shortcut")}</label>
            <span
              className={
                isRecording
                  ? "recording-indicator active"
                  : "recording-indicator"
              }
            >
              {isRecording ? t("common.recording") : t("common.ready")}
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
                placeholder={isRecording ? t("common.recording") : ""}
              />
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={saveShortcut}
              title={t("common.save")}
            >
              <Check size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={resetShortcut}
              title={t("common.reset")}
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </section>

        <section className="settings-section preferences-section">
          <div className="section-heading">
            <label>{t("settings.preferences")}</label>
            {status && <span className="settings-status">{status}</span>}
          </div>

          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-row-icon">
                <AppWindowMac size={17} />
              </div>
              <div className="settings-row-copy">
                <div className="settings-row-title">
                  <span>{t("settings.showDockIcon")}</span>
                  {!isMac && (
                    <span className="settings-row-badge">
                      {t("settings.macOnly")}
                    </span>
                  )}
                </div>
                <p>{t("settings.showDockIconHint")}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.showDockIcon}
                  disabled={!isMac}
                  aria-label={t("settings.showDockIcon")}
                  onChange={handleDockIconChange}
                />
                <span />
              </label>
            </div>

            <div className="settings-row">
              <div className="settings-row-icon">
                <Power size={17} />
              </div>
              <div className="settings-row-copy">
                <div className="settings-row-title">
                  {t("settings.autoStart")}
                </div>
                <p>{t("settings.autoStartHint")}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={autoStart}
                  aria-label={t("settings.autoStart")}
                  onChange={handleAutoStartChange}
                />
                <span />
              </label>
            </div>

            <div className="settings-row stacked">
              <div className="settings-row-main">
                <div className="settings-row-icon">
                  <FolderOpen size={17} />
                </div>
                <div className="settings-row-copy">
                  <div className="settings-row-title">
                    {t("settings.defaultSaveDirectory")}
                  </div>
                  <p>{t("settings.defaultSaveDirectoryHint")}</p>
                </div>
              </div>
              <div className="path-row">
                <div
                  className={
                    settings.defaultSaveDirectory
                      ? "path-display"
                      : "path-display empty"
                  }
                  title={saveDirectoryLabel}
                >
                  {saveDirectoryLabel}
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title={t("common.choose")}
                  onClick={() => void chooseSaveDirectory()}
                >
                  <FolderOpen size={17} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title={t("common.clear")}
                  disabled={!settings.defaultSaveDirectory}
                  onClick={clearSaveDirectory}
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-icon">
                <Languages size={17} />
              </div>
              <div className="settings-row-copy">
                <div className="settings-row-title">
                  {t("settings.language")}
                </div>
                <p>{t("settings.languageTitle")}</p>
              </div>
              <div className="select-wrap">
                <Settings2 size={15} />
                <select
                  value={settings.language}
                  onChange={(event) => void handleLanguageChange(event)}
                >
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
