import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  AppWindowMac,
  Check,
  Crosshair,
  Eye,
  ExternalLink,
  Fingerprint,
  FolderOpen,
  Keyboard,
  Languages,
  Pencil,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
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
  VISIBLE_WATERMARK_PLACEMENTS,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  WATERMARK_TEXT_MAX_LENGTH,
  updateSettings,
  type AppSettings,
  type AppLanguage,
  type VisibleWatermarkPlacement,
} from "./logic/settings";
import { decodeHiddenWatermarkFromFile } from "./logic/watermark";
import PinWindow from "./windows/Pin";
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

const VISIBLE_WATERMARK_PLACEMENT_LABEL_KEYS: Record<
  VisibleWatermarkPlacement,
  string
> = {
  "repeat-diagonal": "settings.watermark.repeatDiagonal",
  "repeat-horizontal": "settings.watermark.repeatHorizontal",
  "top-left": "settings.watermark.topLeft",
  "top-right": "settings.watermark.topRight",
  "bottom-left": "settings.watermark.bottomLeft",
  "bottom-right": "settings.watermark.bottomRight",
};

type MacosPermissionKind = "accessibility" | "screenRecording";

type MacosPermissionStatus = {
  macos: boolean;
  accessibility: boolean;
  eventPosting: boolean;
  screenRecording: boolean;
};
type HiddenWatermarkDetectionStatus =
  | "idle"
  | "detecting"
  | "detected"
  | "empty"
  | "failed";
type HiddenWatermarkDetectionState = {
  status: HiddenWatermarkDetectionStatus;
  message: string;
};

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

  if (path === "/pin") {
    return <PinWindow />;
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

  const [draftShortcut, setDraftShortcut] = useState(getShortcut);
  const [settings, setSettings] = useState(getSettings);
  const [autoStart, setAutoStart] = useState(false);
  const [permissions, setPermissions] = useState<MacosPermissionStatus | null>(
    null
  );
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);
  const [isEditingShortcut, setIsEditingShortcut] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [hiddenWatermarkDetection, setHiddenWatermarkDetection] =
    useState<HiddenWatermarkDetectionState>({
      status: "idle",
      message: "",
    });
  const [
    isHiddenWatermarkDetectionOverflowing,
    setIsHiddenWatermarkDetectionOverflowing,
  ] = useState(false);
  const shortcutInputRef = useRef<HTMLInputElement>(null);
  const hiddenWatermarkInputRef = useRef<HTMLInputElement>(null);
  const hiddenWatermarkDetectionResultRef = useRef<HTMLSpanElement>(null);
  const isMac = useMemo(
    () => navigator.platform.toLowerCase().includes("mac"),
    []
  );
  const saveDirectoryLabel =
    settings.defaultSaveDirectory || t("settings.defaultSaveDirectoryEmpty");
  const hiddenWatermarkDetectionLabel =
    hiddenWatermarkDetection.message || t("settings.watermark.detectHint");

  useEffect(() => {
    const element = hiddenWatermarkDetectionResultRef.current;
    if (!element) return;

    const updateOverflowState = () => {
      const isOverflowing = element.scrollWidth > element.clientWidth;
      setIsHiddenWatermarkDetectionOverflowing((current) =>
        current === isOverflowing ? current : isOverflowing
      );
    };

    updateOverflowState();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateOverflowState)
        : null;
    resizeObserver?.observe(element);
    window.addEventListener("resize", updateOverflowState);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverflowState);
    };
  }, [hiddenWatermarkDetectionLabel]);

  const refreshPermissions = useCallback(async () => {
    if (!isMac) {
      setPermissions({
        macos: false,
        accessibility: true,
        eventPosting: true,
        screenRecording: true,
      });
      return;
    }

    setIsRefreshingPermissions(true);
    try {
      const nextPermissions = await invoke<MacosPermissionStatus>(
        "get_macos_permissions"
      );
      setPermissions(nextPermissions);
    } catch (error) {
      console.warn("Failed to read macOS permissions:", error);
      setStatus(t("settings.status.permissionsReadFailed"));
    } finally {
      setIsRefreshingPermissions(false);
    }
  }, [isMac, t]);

  useEffect(() => {
    void refreshPermissions();

    const handleFocus = () => void refreshPermissions();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshPermissions();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshPermissions]);

  const openPermissionSettings = async (kind: MacosPermissionKind) => {
    try {
      await invoke("open_macos_permission_settings", { kind });
      setStatus(t("settings.status.permissionsOpened"));
      window.setTimeout(() => void refreshPermissions(), 700);
    } catch (error) {
      console.warn("Failed to open macOS permission settings:", error);
      setStatus(t("settings.status.permissionsOpenFailed"));
    }
  };

  const applySettings = (patch: Partial<AppSettings>) => {
    const nextSettings = updateSettings(patch);
    setSettings(nextSettings);
    return nextSettings;
  };

  const restoreSettings = (previousSettings: AppSettings) => {
    updateSettings({
      showDockIcon: previousSettings.showDockIcon,
      defaultSaveDirectory: previousSettings.defaultSaveDirectory,
    });
    setSettings(previousSettings);
  };

  const editShortcut = () => {
    setDraftShortcut(getShortcut());
    setIsEditingShortcut(true);
    setIsRecording(true);
    setStatus("");
    window.requestAnimationFrame(() => shortcutInputRef.current?.focus());
  };

  const saveShortcut = async () => {
    if (!draftShortcut) return;

    try {
      await setShortcut(draftShortcut);
      setStatus(t("settings.status.saved"));
      setIsEditingShortcut(false);
      setIsRecording(false);
    } catch {
      setStatus(t("settings.status.shortcutUnavailable"));
    }
  };

  const resetShortcut = async () => {
    setDraftShortcut(DEFAULT_SHORTCUT);
    try {
      await setShortcut(DEFAULT_SHORTCUT);
      setStatus(t("settings.status.reset"));
      setIsEditingShortcut(false);
      setIsRecording(false);
    } catch {
      setStatus(t("settings.status.shortcutUnavailable"));
    }
  };

  const cancelShortcutEdit = () => {
    setDraftShortcut(getShortcut());
    setIsEditingShortcut(false);
    setIsRecording(false);
    setStatus("");
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

  const updateVisibleWatermark = (
    patch: Partial<AppSettings["visibleWatermark"]>
  ) => {
    applySettings({
      visibleWatermark: {
        ...settings.visibleWatermark,
        ...patch,
      },
    });
    setStatus(t("settings.status.updated"));
  };

  const updateHiddenWatermark = (
    patch: Partial<AppSettings["hiddenWatermark"]>
  ) => {
    applySettings({
      hiddenWatermark: {
        ...settings.hiddenWatermark,
        ...patch,
      },
    });
    setStatus(t("settings.status.updated"));
  };

  const handleHiddenWatermarkFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setHiddenWatermarkDetection({
      status: "detecting",
      message: t("settings.watermark.detecting"),
    });
    try {
      const decoded = await decodeHiddenWatermarkFromFile(file);
      setHiddenWatermarkDetection(
        decoded
          ? {
              status: "detected",
              message: t("settings.watermark.detected", {
                text: decoded.text,
              }),
            }
          : {
              status: "empty",
              message: t("settings.watermark.notDetected"),
            }
      );
    } catch (error) {
      console.warn("Failed to detect hidden watermark:", error);
      setHiddenWatermarkDetection({
        status: "failed",
        message: t("settings.watermark.detectFailed"),
      });
    }
  };

  const permissionRows = [
    {
      kind: "accessibility" as const,
      icon: <ShieldCheck size={17} />,
      title: t("settings.permissions.accessibility"),
      hint: t("settings.permissions.accessibilityHint"),
      granted: permissions?.accessibility,
    },
    {
      kind: "screenRecording" as const,
      icon: <AppWindowMac size={17} />,
      title: t("settings.permissions.screenRecording"),
      hint: t("settings.permissions.screenRecordingHint"),
      granted: permissions?.screenRecording,
    },
  ];

  return (
    <main className="settings-shell">
      <div className="settings-panel">
        <div className="settings-header">
          <div className="brand">
            <h1 className="brand-title">
              <img
                className="brand-logo"
                src="/logo-full.png"
                alt={t("settings.appName")}
              />
            </h1>
          </div>
          <button
            className="capture-button"
            type="button"
            onClick={() => startCapture("settings-button")}
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
          <div
            className={
              isEditingShortcut ? "shortcut-row is-editing" : "shortcut-row"
            }
          >
            <div
              className={
                isRecording
                  ? "shortcut-input-wrap is-recording"
                  : "shortcut-input-wrap"
              }
            >
              <Keyboard size={18} />
              <input
                ref={shortcutInputRef}
                id="shortcut-input"
                value={formatShortcut(draftShortcut)}
                readOnly
                onFocus={() => {
                  if (isEditingShortcut) setIsRecording(true);
                }}
                onKeyDown={(event) => {
                  if (!isEditingShortcut) return;
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
            {isEditingShortcut ? (
              <>
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
                  onClick={cancelShortcutEdit}
                  title={t("common.cancel")}
                >
                  <X size={18} />
                </button>
              </>
            ) : (
              <>
                <button
                  className="icon-button"
                  type="button"
                  onClick={editShortcut}
                  title={t("common.edit")}
                >
                  <Pencil size={18} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={resetShortcut}
                  title={t("common.reset")}
                >
                  <RotateCcw size={18} />
                </button>
              </>
            )}
          </div>
        </section>

        <section className="settings-section permissions-section">
          <div className="section-heading">
            <label>{t("settings.permissions.title")}</label>
            <button
              className={
                isRefreshingPermissions
                  ? "section-icon-button is-loading"
                  : "section-icon-button"
              }
              type="button"
              onClick={() => void refreshPermissions()}
              title={t("settings.permissions.refresh")}
              aria-label={t("settings.permissions.refresh")}
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <div className="settings-list">
            {permissionRows.map((permission) => {
              const isGranted = permission.granted === true;
              const isMissing = permission.granted === false;
              const stateLabel =
                permission.granted === undefined
                  ? t("settings.permissions.checking")
                  : isGranted
                    ? t("settings.permissions.granted")
                    : t("settings.permissions.missing");

              return (
                <div
                  className="settings-row permission-row"
                  key={permission.kind}
                >
                  <div className="settings-row-icon">{permission.icon}</div>
                  <div className="settings-row-copy">
                    <div className="settings-row-title">
                      <span>{permission.title}</span>
                      {!isMac && (
                        <span className="settings-row-badge">
                          {t("settings.macOnly")}
                        </span>
                      )}
                    </div>
                    <p>{permission.hint}</p>
                  </div>
                  <div className="permission-actions">
                    <span
                      className={
                        isGranted
                          ? "permission-state granted"
                          : isMissing
                            ? "permission-state missing"
                            : "permission-state"
                      }
                    >
                      {stateLabel}
                    </span>
                    <button
                      className="permission-action"
                      type="button"
                      disabled={!isMac}
                      onClick={() =>
                        void openPermissionSettings(permission.kind)
                      }
                      title={t("settings.permissions.openSettings")}
                    >
                      <ExternalLink size={14} />
                      <span>{t("settings.permissions.openSettings")}</span>
                    </button>
                  </div>
                </div>
              );
            })}
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

            <div className="settings-row stacked watermark-row">
              <div className="settings-row-main watermark-row-main">
                <div className="settings-row-icon">
                  <Eye size={17} />
                </div>
                <div className="settings-row-copy">
                  <div className="settings-row-title">
                    {t("settings.watermark.visible")}
                  </div>
                  <p>{t("settings.watermark.visibleHint")}</p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.visibleWatermark.enabled}
                    aria-label={t("settings.watermark.visible")}
                    onChange={(event) =>
                      updateVisibleWatermark({
                        enabled: event.currentTarget.checked,
                      })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="watermark-controls">
                <input
                  className="settings-text-input"
                  type="text"
                  value={settings.visibleWatermark.text}
                  maxLength={WATERMARK_TEXT_MAX_LENGTH}
                  disabled={!settings.visibleWatermark.enabled}
                  aria-label={t("settings.watermark.visibleText")}
                  placeholder={t("settings.watermark.textPlaceholder")}
                  onChange={(event) =>
                    updateVisibleWatermark({ text: event.currentTarget.value })
                  }
                />
                <div className="watermark-options">
                  <div className="select-wrap watermark-select">
                    <Settings2 size={15} />
                    <select
                      value={settings.visibleWatermark.placement}
                      disabled={!settings.visibleWatermark.enabled}
                      aria-label={t("settings.watermark.placement")}
                      onChange={(event) =>
                        updateVisibleWatermark({
                          placement: event.currentTarget
                            .value as VisibleWatermarkPlacement,
                        })
                      }
                    >
                      {VISIBLE_WATERMARK_PLACEMENTS.map((placement) => (
                        <option key={placement} value={placement}>
                          {t(VISIBLE_WATERMARK_PLACEMENT_LABEL_KEYS[placement])}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="opacity-control">
                    <span>{t("settings.watermark.opacity")}</span>
                    <input
                      type="range"
                      min={WATERMARK_OPACITY_MIN}
                      max={WATERMARK_OPACITY_MAX}
                      step="0.01"
                      value={settings.visibleWatermark.opacity}
                      disabled={!settings.visibleWatermark.enabled}
                      aria-label={t("settings.watermark.opacity")}
                      onChange={(event) =>
                        updateVisibleWatermark({
                          opacity: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="settings-row stacked watermark-row">
              <div className="settings-row-main watermark-row-main">
                <div className="settings-row-icon">
                  <Fingerprint size={17} />
                </div>
                <div className="settings-row-copy">
                  <div className="settings-row-title">
                    {t("settings.watermark.hidden")}
                  </div>
                  <p>{t("settings.watermark.hiddenHint")}</p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.hiddenWatermark.enabled}
                    aria-label={t("settings.watermark.hidden")}
                    onChange={(event) =>
                      updateHiddenWatermark({
                        enabled: event.currentTarget.checked,
                      })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="watermark-controls">
                <input
                  className="settings-text-input"
                  type="text"
                  value={settings.hiddenWatermark.text}
                  maxLength={WATERMARK_TEXT_MAX_LENGTH}
                  disabled={!settings.hiddenWatermark.enabled}
                  aria-label={t("settings.watermark.hiddenText")}
                  placeholder={t("settings.watermark.textPlaceholder")}
                  onChange={(event) =>
                    updateHiddenWatermark({ text: event.currentTarget.value })
                  }
                />
                <div className="watermark-detect-row">
                  <button
                    className="inline-action-button"
                    type="button"
                    onClick={() => hiddenWatermarkInputRef.current?.click()}
                  >
                    <Search size={15} />
                    <span>{t("settings.watermark.detect")}</span>
                  </button>
                  <span
                    ref={hiddenWatermarkDetectionResultRef}
                    className={[
                      "watermark-detection-result",
                      hiddenWatermarkDetection.status !== "idle"
                        ? `is-${hiddenWatermarkDetection.status}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={
                      isHiddenWatermarkDetectionOverflowing
                        ? hiddenWatermarkDetectionLabel
                        : undefined
                    }
                    aria-live="polite"
                  >
                    {hiddenWatermarkDetectionLabel}
                  </span>
                  <input
                    ref={hiddenWatermarkInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(event) =>
                      void handleHiddenWatermarkFileChange(event)
                    }
                  />
                </div>
              </div>
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
