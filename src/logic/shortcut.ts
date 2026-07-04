import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SHORTCUT = "Alt+X";
const SHORTCUT_STORAGE_KEY = "xshot.shortcut";

let registeredShortcut: string | null = null;
let registrationQueue = Promise.resolve();

function readStoredShortcut() {
  if (typeof localStorage === "undefined") return DEFAULT_SHORTCUT;
  return localStorage.getItem(SHORTCUT_STORAGE_KEY) || DEFAULT_SHORTCUT;
}

function writeStoredShortcut(shortcut: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SHORTCUT_STORAGE_KEY, shortcut);
}

export function getShortcut() {
  return readStoredShortcut();
}

export async function startCapture() {
  await invoke("ensure_screenshot_window");
  await emit("start-capture");
}

async function registerAccelerator(shortcut: string) {
  await register(shortcut, async (event) => {
    if (event.state !== "Pressed") return;
    console.log("Shortcut triggered:", shortcut);
    await startCapture();
  });
}

export async function registerShortcut(shortcut = readStoredShortcut()) {
  const task = registrationQueue
    .catch(() => undefined)
    .then(async () => {
      if (registeredShortcut === shortcut) return;

      const previousShortcut = registeredShortcut;
      if (registeredShortcut) {
        try {
          await unregister(registeredShortcut);
          registeredShortcut = null;
        } catch (error) {
          console.warn("Failed to unregister previous shortcut:", error);
        }
      }

      try {
        await registerAccelerator(shortcut);
        registeredShortcut = shortcut;
        console.log("Shortcut registered successfully:", shortcut);
      } catch (error) {
        if (previousShortcut) {
          try {
            await registerAccelerator(previousShortcut);
            registeredShortcut = previousShortcut;
          } catch (restoreError) {
            console.warn("Failed to restore previous shortcut:", restoreError);
          }
        }

        throw error;
      }
    });

  registrationQueue = task.catch(() => undefined);
  return task;
}

export async function setShortcut(shortcut: string) {
  try {
    await registerShortcut(shortcut);
    writeStoredShortcut(shortcut);
  } catch (error) {
    console.error("Failed to set shortcut:", shortcut, error);
    throw error;
  }
}
