import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SHORTCUT = "Alt+X";
const SHORTCUT_STORAGE_KEY = "xshot.shortcut";

let registeredShortcut: string | null = null;
let registrationQueue = Promise.resolve();
let captureSequence = 0;

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

function nextCaptureId() {
  captureSequence += 1;
  return `${Date.now().toString(36)}-${captureSequence.toString(36)}`;
}

function logCaptureTrigger(
  captureId: string,
  source: string,
  startedAt: number,
  stage: string
) {
  console.info(
    `[xshot][capture][trigger] capture_id=${captureId} source=${source} stage=${stage} total_ms=${(
      performance.now() - startedAt
    ).toFixed(1)}`
  );
}

export async function startCapture(
  source = "unknown",
  triggeredAt = performance.now()
) {
  const captureId = nextCaptureId();
  const triggeredAtMs = performance.timeOrigin + triggeredAt;
  logCaptureTrigger(captureId, source, triggeredAt, "triggered");
  try {
    await invoke("start_capture", { captureId, source, triggeredAtMs });
    logCaptureTrigger(captureId, source, triggeredAt, "rust_command_done");
  } catch (error) {
    logCaptureTrigger(captureId, source, triggeredAt, "rust_command_failed");
    throw error;
  }
}

async function registerAccelerator(shortcut: string) {
  await register(shortcut, async (event) => {
    if (event.state !== "Pressed") return;
    const pressedAt = performance.now();
    await startCapture(`shortcut:${shortcut}`, pressedAt);
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
