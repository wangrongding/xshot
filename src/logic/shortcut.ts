import { register } from "@tauri-apps/plugin-global-shortcut";
import { emit } from "@tauri-apps/api/event";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";

export async function registerShortcut() {
  // 1. 注册快捷键 Alt+X
  await register("Alt+X", async (event) => {
    if (event.state === "Pressed") {
      console.log("Shortcut triggered!");
      
      // 2. 事件分发：通知截图窗口开始工作
      // 这里我们找到截图窗口并显示它，同时发送开始信号
      const windows = await getAllWebviewWindows();
      console.log("All windows:", windows.map(w => w.label));
      const screenshotWin = windows.find(w => w.label === "screenshot_window");
      
      if (screenshotWin) {
        console.log("Found screenshot window, starting capture...");
        // 先发送事件，让窗口进行截图
        // 注意：不要在这里 show()，否则会把白屏窗口也截进去
        // 等截图完成后，由 ScreenshotWindow 自己调用 show()
        await emit("start-capture");
      } else {
        console.error("Screenshot window not found!");
      }
    }
  });
}
