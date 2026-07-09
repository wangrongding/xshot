export type AppLanguage = "zh-CN" | "en-US";
export type VisibleWatermarkPlacement =
  | "repeat-diagonal"
  | "repeat-horizontal"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type VisibleWatermarkSettings = {
  enabled: boolean;
  text: string;
  placement: VisibleWatermarkPlacement;
  opacity: number;
};

export type HiddenWatermarkSettings = {
  enabled: boolean;
  text: string;
};

export type AppSettings = {
  showDockIcon: boolean;
  defaultSaveDirectory: string;
  language: AppLanguage;
  visibleWatermark: VisibleWatermarkSettings;
  hiddenWatermark: HiddenWatermarkSettings;
};

const SETTINGS_STORAGE_KEY = "xshot.settings";
export const WATERMARK_TEXT_MAX_LENGTH = 160;
export const WATERMARK_OPACITY_MIN = 0.08;
export const WATERMARK_OPACITY_MAX = 0.35;

export const VISIBLE_WATERMARK_PLACEMENTS: VisibleWatermarkPlacement[] = [
  "repeat-diagonal",
  "repeat-horizontal",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export const SUPPORTED_LANGUAGES: Array<{
  value: AppLanguage;
  label: string;
}> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
];

export const DEFAULT_SETTINGS: AppSettings = {
  showDockIcon: true,
  defaultSaveDirectory: "",
  language: "zh-CN",
  visibleWatermark: {
    enabled: false,
    text: "",
    placement: "repeat-diagonal",
    opacity: 0.16,
  },
  hiddenWatermark: {
    enabled: false,
    text: "",
  },
};

function isAppLanguage(value: unknown): value is AppLanguage {
  return SUPPORTED_LANGUAGES.some((language) => language.value === value);
}

function isVisibleWatermarkPlacement(
  value: unknown
): value is VisibleWatermarkPlacement {
  return VISIBLE_WATERMARK_PLACEMENTS.some((placement) => placement === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWatermarkText(value: unknown) {
  return typeof value === "string"
    ? value.slice(0, WATERMARK_TEXT_MAX_LENGTH)
    : "";
}

function normalizeVisibleWatermarkSettings(
  value: unknown
): VisibleWatermarkSettings {
  const rawWatermark = isRecord(value) ? value : {};
  const rawOpacity = Number(rawWatermark.opacity);
  const opacity = Number.isFinite(rawOpacity)
    ? clampNumber(rawOpacity, WATERMARK_OPACITY_MIN, WATERMARK_OPACITY_MAX)
    : DEFAULT_SETTINGS.visibleWatermark.opacity;

  return {
    enabled:
      typeof rawWatermark.enabled === "boolean"
        ? rawWatermark.enabled
        : DEFAULT_SETTINGS.visibleWatermark.enabled,
    text: normalizeWatermarkText(rawWatermark.text),
    placement: isVisibleWatermarkPlacement(rawWatermark.placement)
      ? rawWatermark.placement
      : DEFAULT_SETTINGS.visibleWatermark.placement,
    opacity,
  };
}

function normalizeHiddenWatermarkSettings(
  value: unknown
): HiddenWatermarkSettings {
  const rawWatermark = isRecord(value) ? value : {};

  return {
    enabled:
      typeof rawWatermark.enabled === "boolean"
        ? rawWatermark.enabled
        : DEFAULT_SETTINGS.hiddenWatermark.enabled,
    text: normalizeWatermarkText(rawWatermark.text),
  };
}

function getSystemLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return DEFAULT_SETTINGS.language;

  const systemLanguages =
    navigator.languages?.length > 0
      ? navigator.languages
      : [navigator.language];

  for (const systemLanguage of systemLanguages) {
    if (!systemLanguage) continue;

    const languageCode = systemLanguage.toLowerCase();
    const languageBase = languageCode.split("-")[0];
    const matchedLanguage = SUPPORTED_LANGUAGES.find((language) => {
      const supportedLanguage = language.value.toLowerCase();
      return (
        supportedLanguage === languageCode ||
        supportedLanguage.split("-")[0] === languageBase
      );
    });

    if (matchedLanguage) return matchedLanguage.value;
  }

  return DEFAULT_SETTINGS.language;
}

function readRawSettings(): Partial<AppSettings> {
  if (typeof localStorage === "undefined") return {};

  try {
    const rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!rawSettings) return {};
    const parsedSettings = JSON.parse(rawSettings) as Partial<AppSettings>;
    return parsedSettings && typeof parsedSettings === "object"
      ? parsedSettings
      : {};
  } catch {
    return {};
  }
}

export function getSettings(): AppSettings {
  const rawSettings = readRawSettings();

  return {
    showDockIcon:
      typeof rawSettings.showDockIcon === "boolean"
        ? rawSettings.showDockIcon
        : DEFAULT_SETTINGS.showDockIcon,
    defaultSaveDirectory:
      typeof rawSettings.defaultSaveDirectory === "string"
        ? rawSettings.defaultSaveDirectory
        : DEFAULT_SETTINGS.defaultSaveDirectory,
    language: isAppLanguage(rawSettings.language)
      ? rawSettings.language
      : getSystemLanguage(),
    visibleWatermark: normalizeVisibleWatermarkSettings(
      rawSettings.visibleWatermark
    ),
    hiddenWatermark: normalizeHiddenWatermarkSettings(
      rawSettings.hiddenWatermark
    ),
  };
}

function writeSettings(settings: Partial<AppSettings>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function saveSettings(settings: AppSettings) {
  writeSettings(settings);
}

export function updateSettings(patch: Partial<AppSettings>) {
  const rawSettings = readRawSettings();
  const currentSettings = getSettings();
  const nextSettings: AppSettings = {
    ...currentSettings,
    ...patch,
    visibleWatermark: normalizeVisibleWatermarkSettings({
      ...currentSettings.visibleWatermark,
      ...patch.visibleWatermark,
    }),
    hiddenWatermark: normalizeHiddenWatermarkSettings({
      ...currentSettings.hiddenWatermark,
      ...patch.hiddenWatermark,
    }),
  };
  const nextStoredSettings: Partial<AppSettings> = {
    showDockIcon: nextSettings.showDockIcon,
    defaultSaveDirectory: nextSettings.defaultSaveDirectory,
    visibleWatermark: nextSettings.visibleWatermark,
    hiddenWatermark: nextSettings.hiddenWatermark,
  };

  if (isAppLanguage(rawSettings.language) || isAppLanguage(patch.language)) {
    nextStoredSettings.language = nextSettings.language;
  }

  writeSettings(nextStoredSettings);
  return nextSettings;
}
