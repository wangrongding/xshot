# xshot

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a> |
  <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="./public/logo-full.png" alt="xshot" width="360" />
</p>

<p align="center">
  <strong>輕量、常駐、順手的桌面截圖工具。</strong>
</p>

xshot 是一款桌面截圖工具，支援快捷截圖、視窗/區域選擇、標註、截長圖、裁切、固定到螢幕、複製和儲存，預設透過系統匣和全域快捷鍵使用。

## 多語言文件

簡體中文 README 是文件維護基準。功能說明、安裝提示、限制和路線圖發生變更時，請先更新 `README.md`，再同步 English、繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil) 和 Русский 版本。

## 核心能力

- ✅ 支援滾動截長圖。
- ✅ 支援將截圖結果固定為置頂浮動視窗。
- ✅ 支援 OCR 文字辨識、QR Code 辨識、文字翻譯和翻譯覆蓋原文。
- ✅ 支援標註工具：序號標註、箭頭、矩形選框、直線、文字、畫筆、橡皮擦和框選馬賽克。
- ✅ 支援視窗 hover 辨識，移動到候選視窗上點擊即可選中該視窗。

![screenshot/xshot.jpeg](./screenshot/xshot.jpeg)

## 使用方式

啟動應用後，xshot 會在系統匣中執行。你可以透過以下方式開始截圖：

- 按下預設全域快捷鍵 `Option + X` / `Alt + X`。

## 平台權限與安裝

- macOS 首次開啟如果提示無法驗證開發者，請到 `系統設定` -> `隱私權與安全性` 中點擊 `仍要打開`。
- 如果仍無法開啟，可執行 `xattr -dr com.apple.quarantine /Applications/xshot.app` 後再試。
- macOS 首次截圖可能需要授予螢幕錄製權限；授權後建議重新啟動應用。
- macOS 截長圖需要輔助使用權限，用於監聽/過濾滾輪事件並讓選區下方視窗接收滾動。
- OCR 基於 macOS Vision；翻譯需要網路存取，預設使用 Google Translate。
- Dock 圖示開關僅適用於 macOS。
- 目前截圖主流程只處理主顯示器，多顯示器支援仍在完善。
- 視窗 hover 辨識依賴系統視窗列舉，部分系統視窗、遮罩層或全螢幕應用可能表現不同。

## 設定項

- 快捷鍵：點擊編輯後輸入新的組合鍵，儲存後立即生效。
- 重設快捷鍵：恢復預設 `Option + X` / `Alt + X`。
- Dock 圖示：macOS 下可控制是否在 Dock 中顯示應用圖示。
- 開機自動啟動：登入系統後自動啟動 xshot。
- 預設儲存位置：下載截圖時優先儲存到指定資料夾；未設定時使用下載目錄。
- 介面語言：目前支援簡體中文和 English。
- 權限：macOS 下可查看螢幕錄製和輔助使用授權狀態，並直接開啟對應系統設定面板。

## 目前截圖流程

- 應用啟動時會建立並隱藏截圖 WebView，觸發截圖時重用該視窗。
- macOS 一般截圖目前使用系統 `screencapture -x -R <截圖視窗區域>`，產物會先寫入臨時 PNG，再讀回前端編輯層。
- Windows / Linux 目前透過 `xcap` 擷取顯示器，並在 Rust 側編碼 PNG。
- macOS 截長圖會讓截圖視窗滑鼠穿透，滾輪事件只透傳向下滾動；每幀優先使用 CoreGraphics `CGWindowListCreateImage` 擷取截圖視窗下方的選區內容，失敗時回退到 `screencapture -R`。
- 截長圖拼接按兩幀真實縱向位移追加新增列，小位移不更新上一幀，避免重複紋理或白底導致一次追加過多內容。
- 長圖生成後進入裁切/編輯視圖，複製和儲存會按目前裁切區域匯出。
- 固定截圖會把目前匯出的 PNG 寫入臨時目錄，再建立一個無邊框、置頂、跨工作區可見的獨立 Tauri 視窗承載圖片。
- OCR 透過 macOS Vision `VNRecognizeTextRequest` 辨識文字，優先 accurate，失敗時回退 fast；QR Code 辨識使用 `VNDetectBarcodesRequest`。
- 翻譯由 Rust 後端呼叫 Google Translate 介面，支援系統代理；翻譯覆蓋會按 OCR block 座標生成可編輯、可復原的文字標註，再次點擊會移除已生成的覆蓋層。
- 截圖流程保留了分段耗時日誌，方便定位快捷鍵觸發、截圖取得、圖片解碼、視窗展示等階段的延遲。
- 此前試驗過 ScreenCaptureKit，但目前品質和收益未達預期，因此主流程繼續保留穩定的 fallback 方案。

## 開發

Tauri 環境安裝參考：<https://v2.tauri.app/start/prerequisites/>

前置要求：

- Node.js
- pnpm
- Rust
- Tauri v2 系統依賴

常用命令：

```bash
pnpm install       # 安裝依賴
pnpm dev           # 啟動 Tauri 開發環境
pnpm dev:web       # 只啟動 Vite 前端
pnpm build:web     # 建置前端
pnpm build         # 建置桌面應用
pnpm tsc           # TypeScript 檢查
pnpm format        # Prettier + cargo fmt
```

專案結構：

```text
src/                    React 前端
src/windows/            截圖視窗
src/logic/              設定、快捷鍵、游標等前端邏輯
src-tauri/              Tauri / Rust 後端
src-tauri/src/lib.rs    截圖、系統匣、剪貼簿、視窗命令註冊
src-tauri/src/ocr.rs    macOS Vision OCR / QR Code 辨識
src-tauri/src/translation.rs  翻譯服務
public/                 應用圖片資源
```

## 目前限制

- 多顯示器支援仍不完整。
- 截長圖目前是 macOS 優先能力，依賴螢幕錄製和輔助使用權限；目前只支援向下滾動拼接。
- OCR 目前是 macOS 優先能力；翻譯依賴網路和 Google Translate 可用性。
- 標註屬性修改目前即時生效，尚未作為獨立動作納入復原堆疊。
- 圖片格式選擇、啟動參數、工具列自訂等進階設定尚未開放。
- 視窗截圖依賴候選視窗辨識，極少數透明視窗、系統浮層或全螢幕空間可能無法準確命中。

## 路線圖

- 完善多顯示器截圖和座標映射。
- 增加圖片格式和品質設定。
- 讓標註屬性修改進入更完整的復原/重做堆疊。
- 支援更多標註樣式和工具列設定。
- 完善安裝包、發布流程和平台相容性驗證。

## 技術棧

- Tauri v2
- React 19
- TypeScript
- Vite
- Fabric.js
- lucide-react
- i18next / react-i18next
- xcap / image
- Tauri autostart / dialog / global-shortcut / clipboard-manager / opener plugins
- ai-ins Vite plugin
