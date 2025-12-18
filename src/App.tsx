import { useEffect } from "react";
import { registerShortcut } from "./logic/shortcut";
import ScreenshotWindow from "./windows/Screenshot";
import { invoke } from "@tauri-apps/api/core";
import './App.css'

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

  return (
    <div className="container">
      <h1>xshot Main Process</h1>
      <p>Press <b>Alt + X</b> to take a screenshot.</p>
      <p>The screenshot window is preloaded and hidden.</p>
      <div style={{ marginTop: 20 }}>
        <button onClick={() => invoke('open_devtools')}>Open Main DevTools</button>
        <button onClick={() => invoke('open_screenshot_devtools')} style={{ marginLeft: 10 }}>Open Screenshot DevTools</button>
        <p style={{ fontSize: 12, color: '#666' }}>Or press Cmd + Option + I</p>
      </div>
    </div>
  );
}

export default App;
