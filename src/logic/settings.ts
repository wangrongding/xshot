export type AppLanguage = "zh-CN" | "en-US";

export type AppSettings = {
  showDockIcon: boolean;
  defaultSaveDirectory: string;
  language: AppLanguage;
};

const SETTINGS_STORAGE_KEY = "xshot.settings";

export const SUPPORTED_LANGUAGES: Array<{
  value: AppLanguage;
  label: string;
}> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
];

export const DEFAULT_SETTINGS: AppSettings = {
  showDockIcon: false,
  defaultSaveDirectory: "",
  language: "zh-CN",
};

function isAppLanguage(value: unknown): value is AppLanguage {
  return SUPPORTED_LANGUAGES.some((language) => language.value === value);
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
      : DEFAULT_SETTINGS.language,
  };
}

export function saveSettings(settings: AppSettings) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function updateSettings(patch: Partial<AppSettings>) {
  const nextSettings = { ...getSettings(), ...patch };
  saveSettings(nextSettings);
  return nextSettings;
}
