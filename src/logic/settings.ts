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
  showDockIcon: true,
  defaultSaveDirectory: "",
  language: "zh-CN",
};

function isAppLanguage(value: unknown): value is AppLanguage {
  return SUPPORTED_LANGUAGES.some((language) => language.value === value);
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
  const nextSettings = { ...getSettings(), ...patch };
  const nextStoredSettings: Partial<AppSettings> = {
    showDockIcon: nextSettings.showDockIcon,
    defaultSaveDirectory: nextSettings.defaultSaveDirectory,
  };

  if (isAppLanguage(rawSettings.language) || isAppLanguage(patch.language)) {
    nextStoredSettings.language = nextSettings.language;
  }

  writeSettings(nextStoredSettings);
  return nextSettings;
}
