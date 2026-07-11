import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Download,
  Eraser,
  FileText,
  Grid3X3,
  Languages,
  Loader2,
  Palette,
  PenLine,
  Pin,
  Pointer,
  Redo2,
  RectangleHorizontal,
  Slash,
  Type,
  Undo2,
  X,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";
import * as fabric from "fabric";
import { cursorManager, ToolType } from "../logic/cursor";
import { getSettings } from "../logic/settings";
import { applyWatermarksToBlob } from "../logic/watermark";

if (typeof document !== "undefined") {
  document.documentElement.style.backgroundColor = "transparent";
  document.body.style.backgroundColor = "transparent";
}

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; width: number; height: number };
type ResizeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
type SelectionDragState =
  | { mode: "new"; start: Point }
  | { mode: "window"; start: Point; bounds: Bounds }
  | { mode: "move"; start: Point; initial: Bounds }
  | { mode: "resize"; start: Point; initial: Bounds; handle: ResizeHandle };
type CaptureWindowRegion = Bounds & {
  id: number;
  pid: number;
  title: string;
  appName: string;
  isFullscreenLike: boolean;
  isOverlayCandidate: boolean;
  isFocused: boolean;
};
type RawCaptureWindowRegion = {
  id: number;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  monitor_width: number;
  monitor_height: number;
  is_fullscreen_like: boolean;
  is_overlay_candidate: boolean;
  is_focused: boolean;
  title: string;
  app_name: string;
};
type CaptureStartPayload = {
  id: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
  name: string;
  captureId: string;
  source: string;
  triggeredAtMs: number;
};
type CaptureHoverPointPayload = {
  label: string;
  x: number;
  y: number;
  monitorWidth: number;
  monitorHeight: number;
};
type EditorTool =
  | "select"
  | "sequence"
  | "mosaic-rect"
  | "pen"
  | "eraser"
  | "arrow"
  | "rect"
  | "line"
  | "text";
type AnnotationTool = Exclude<EditorTool, "select" | "eraser">;
type StrokeTool = Extract<EditorTool, "pen" | "arrow" | "rect" | "line">;
type TextTool = Extract<EditorTool, "text">;
type LongCaptureStatus = "idle" | "waiting" | "capturing" | "ready" | "failed";
type OcrPanelStatus =
  | "idle"
  | "recognizing"
  | "ready"
  | "translating"
  | "failed";
type LongCaptureState = {
  status: LongCaptureStatus;
  frameCount: number;
  height: number;
  messageKey: string | null;
};
type MacosPermissionStatus = {
  macos: boolean;
  accessibility: boolean;
  eventPosting: boolean;
  screenRecording: boolean;
};
type LongCaptureScrollEvent = {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
};
type OcrBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type OcrTextBlock = {
  text: string;
  confidence: number;
  bounds: OcrBounds;
};
type OcrQrCode = {
  value: string;
  url: string | null;
  bounds: OcrBounds;
};
type OcrScanResult = {
  text: string;
  blocks: OcrTextBlock[];
  qrCodes: OcrQrCode[];
  imageWidth: number;
  imageHeight: number;
};
type AnnotationData = {
  role: "annotation";
  tool: AnnotationTool;
  source?: "translation-overlay";
  color?: string;
  strokeWidth?: number;
  fontSize?: number;
};
type OcrPanelState = {
  status: OcrPanelStatus;
  targetLang: string;
  result: OcrScanResult | null;
  displayText: string;
  error: string | null;
  showingTranslation: boolean;
};
type HistoryAction =
  | { type: "add"; objects: fabric.Object[] }
  | { type: "remove"; objects: fabric.Object[] };

const MIN_SELECTION_SIZE = 18;
const DEFAULT_STROKE_WIDTH = 4;
const STROKE_WIDTH_OPTIONS = [2, 4, 6, 8];
const DEFAULT_TEXT_SIZE = 28;
const TEXT_SIZE_OPTIONS = [18, 24, 32, 40];
const ERASER_SIZE = 22;
const MOSAIC_BLOCK_SIZE = 10;
const SELECTION_HANDLE_SIZE = 9;
const SELECTION_HANDLE_HIT_SIZE = 12;
const SELECTION_EDGE_HIT_SIZE = 7;
const SELECTION_BORDER_WIDTH = 2;
const TOOLBAR_MARGIN = 10;
const TOOLBAR_SAFE_TOP = 76;
const DEFAULT_TOOLBAR_WIDTH = 560;
const DEFAULT_TOOLBAR_HEIGHT = 54;
const WINDOW_CLICK_DRAG_THRESHOLD = 5;
const LONG_CAPTURE_MANUAL_CAPTURE_INTERVAL = 150;
const LONG_CAPTURE_SCROLL_SETTLE_DELAY = 250;
const LONG_CAPTURE_MAX_HEIGHT = 30000;
const LONG_CAPTURE_MIN_OVERLAP = 32;
const LONG_CAPTURE_MATCH_THRESHOLD = 28;
const LONG_CAPTURE_MIN_SHIFT_RATIO = 0.1;
const LONG_CAPTURE_MIN_OVERLAP_RATIO = 0.2;
const LONG_CAPTURE_OFFSET_SCORE_BIAS = 6;
const LONG_CAPTURE_SHORTCUTS = ["Enter", "Escape"];
const LONG_CAPTURE_PREVIEW_WIDTH = 152;
const LONG_CAPTURE_PREVIEW_HEIGHT = 240;
const LONG_CAPTURE_PANEL_WIDTH = 380;
const LONG_CAPTURE_PANEL_HEIGHT = 262;
const LONG_CAPTURE_PANEL_GAP = 14;
const LONG_CAPTURE_PANEL_MARGIN = 16;
const OCR_PANEL_WIDTH = 430;
const OCR_PANEL_HEIGHT = 430;
const OCR_PANEL_GAP = 14;
const OCR_PANEL_MARGIN = 16;
const OCR_TARGET_LANGUAGE_STORAGE_KEY = "xshot.ocr.targetLanguage";
const TRANSLATION_LANGUAGES = [
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "ar", name: "العربية" },
  { code: "tr", name: "Türkçe" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ไทย" },
  { code: "id", name: "Indonesia" },
  { code: "hi", name: "हिन्दी" },
];
const RESIZE_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

const SequenceToolIcon = createLucideIcon("SequenceToolIcon", [
  ["circle", { cx: "12", cy: "12", r: "8.5" }],
  ["path", { d: "M10.5 9.5 12.5 8v8" }],
  ["path", { d: "M10.25 16h4.5" }],
]);

const ArrowToolIcon = createLucideIcon("ArrowToolIcon", [
  ["path", { d: "M6 18 18 6" }],
  ["path", { d: "M10 6h8v8" }],
]);

const LongCaptureIcon = createLucideIcon("LongCaptureIcon", [
  ["path", { d: "M8 4h8" }],
  ["path", { d: "M8 20h8" }],
  ["rect", { x: "7", y: "7", width: "10", height: "10", rx: "1.5" }],
  ["path", { d: "M12 10v4" }],
  ["path", { d: "m9.75 12.75 2.25 2.25 2.25-2.25" }],
]);

const TOOL_BUTTONS: Array<{
  tool: EditorTool;
  titleKey: string;
  icon: LucideIcon;
}> = [
  { tool: "select", titleKey: "screenshot.tools.select", icon: Pointer },
  {
    tool: "sequence",
    titleKey: "screenshot.tools.sequence",
    icon: SequenceToolIcon,
  },
  { tool: "arrow", titleKey: "screenshot.tools.arrow", icon: ArrowToolIcon },
  {
    tool: "rect",
    titleKey: "screenshot.tools.rect",
    icon: RectangleHorizontal,
  },
  { tool: "line", titleKey: "screenshot.tools.line", icon: Slash },
  { tool: "text", titleKey: "screenshot.tools.text", icon: Type },
  { tool: "pen", titleKey: "screenshot.tools.pen", icon: PenLine },
  { tool: "eraser", titleKey: "screenshot.tools.eraser", icon: Eraser },
  {
    tool: "mosaic-rect",
    titleKey: "screenshot.tools.mosaicRect",
    icon: Grid3X3,
  },
];

function isStrokeTool(tool: EditorTool | undefined): tool is StrokeTool {
  return (
    tool === "pen" || tool === "arrow" || tool === "rect" || tool === "line"
  );
}

function isTextTool(tool: EditorTool | undefined): tool is TextTool {
  return tool === "text";
}

function isTranslationOverlay(object: fabric.Object) {
  return (
    isAnnotation(object) &&
    getAnnotationData(object)?.source === "translation-overlay"
  );
}

type CaptureTimingTrace = {
  captureId: string;
  source: string;
  triggeredAtMs: number;
  uiStartedAt: number;
  lastMark: number;
  monitorLabel: string;
};

function captureEpochNow(performanceNow = performance.now()) {
  return performance.timeOrigin + performanceNow;
}

function logCaptureTiming(
  trace: CaptureTimingTrace,
  stage: string,
  extra?: string
) {
  const now = performance.now();
  const stageMs = now - trace.lastMark;
  const uiTotalMs = now - trace.uiStartedAt;
  const e2eMs = captureEpochNow(now) - trace.triggeredAtMs;
  trace.lastMark = now;
  const suffix = extra ? ` ${extra}` : "";
  console.info(
    `[xshot][capture][ui] capture_id=${trace.captureId} source=${trace.source} monitor=${trace.monitorLabel} stage=${stage} stage_ms=${stageMs.toFixed(1)} ui_total_ms=${uiTotalMs.toFixed(1)} e2e_ms=${e2eMs.toFixed(1)}${suffix}`
  );
}

function recordCaptureUiResult(
  trace: CaptureTimingTrace,
  status: "ready" | "failed",
  stage: string,
  error?: unknown
) {
  const now = performance.now();
  void invoke("record_capture_ui_timing", {
    timing: {
      captureId: trace.captureId,
      source: trace.source,
      monitorLabel: trace.monitorLabel,
      status,
      stage,
      uiTotalMs: now - trace.uiStartedAt,
      e2eMs: captureEpochNow(now) - trace.triggeredAtMs,
      error: error === undefined ? null : String(error),
    },
  }).catch((recordError) => {
    console.warn("Failed to record capture UI timing:", recordError);
  });
}

function logLongCaptureDebug(label: string, payload?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  if (payload) console.debug(`[xshot] long capture ${label}`, payload);
  else console.debug(`[xshot] long capture ${label}`);
}

function isImeComposingEvent(event: KeyboardEvent) {
  return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

function isKeyboardInputTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  if (target.closest("input, textarea, select")) return true;

  const editable = target.closest("[contenteditable]");
  return editable instanceof HTMLElement && editable.isContentEditable;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForNextPaint() {
  return new Promise<void>((resolve) =>
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => resolve())
    )
  );
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = makeCanvas(source.width, source.height);
  const context = canvas.getContext("2d");
  context?.drawImage(source, 0, 0);
  return canvas;
}

function imageToCanvas(image: HTMLImageElement) {
  const canvas = makeCanvas(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height
  );
  const context = canvas.getContext("2d");
  context?.drawImage(image, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/png")
  );
}

async function imageFromBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  await image.decode();
  return { image, url };
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function sampleAverageColor(canvas: HTMLCanvasElement, bounds: OcrBounds) {
  const context = canvas.getContext("2d");
  if (!context) return { color: "rgb(255, 255, 255)", light: true };

  const x = Math.max(0, Math.floor(bounds.x * canvas.width));
  const y = Math.max(0, Math.floor(bounds.y * canvas.height));
  const width = Math.max(1, Math.ceil(bounds.width * canvas.width));
  const height = Math.max(1, Math.ceil(bounds.height * canvas.height));
  const sampleWidth = Math.min(width, canvas.width - x);
  const sampleHeight = Math.min(height, canvas.height - y);
  if (sampleWidth <= 0 || sampleHeight <= 0) {
    return { color: "rgb(255, 255, 255)", light: true };
  }

  const data = context.getImageData(x, y, sampleWidth, sampleHeight).data;
  const xStep = Math.max(1, Math.floor(sampleWidth / 6));
  const yStep = Math.max(1, Math.floor(sampleHeight / 6));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let py = 0; py < sampleHeight; py += yStep) {
    for (let px = 0; px < sampleWidth; px += xStep) {
      const index = (py * sampleWidth + px) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      count += 1;
    }
  }

  if (count === 0) return { color: "rgb(255, 255, 255)", light: true };

  const red = clampByte(r / count);
  const green = clampByte(g / count);
  const blue = clampByte(b / count);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return {
    color: `rgb(${red}, ${green}, ${blue})`,
    light: luminance >= 0.58,
  };
}

function cropSelectionFrame(
  image: HTMLImageElement,
  bounds: Bounds,
  scale: number
) {
  const sourceX = Math.max(0, Math.round(bounds.left / scale));
  const sourceY = Math.max(0, Math.round(bounds.top / scale));
  const sourceWidth = Math.max(1, Math.round(bounds.width / scale));
  const sourceHeight = Math.max(1, Math.round(bounds.height / scale));
  const frame = makeCanvas(sourceWidth, sourceHeight);
  const context = frame.getContext("2d");
  if (!context) return null;

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  return frame;
}

function scoreVerticalOverlap(
  previousData: Uint8ClampedArray,
  currentData: Uint8ClampedArray,
  width: number,
  previousHeight: number,
  overlap: number
) {
  const xStep = Math.max(4, Math.floor(width / 160));
  const yStep = Math.max(4, Math.floor(overlap / 90));
  const previousStartY = previousHeight - overlap;
  let diff = 0;
  let samples = 0;

  for (let y = 0; y < overlap; y += yStep) {
    const previousY = previousStartY + y;
    for (let x = 0; x < width; x += xStep) {
      const previousIndex = (previousY * width + x) * 4;
      const currentIndex = (y * width + x) * 4;
      diff += Math.abs(previousData[previousIndex] - currentData[currentIndex]);
      diff += Math.abs(
        previousData[previousIndex + 1] - currentData[currentIndex + 1]
      );
      diff += Math.abs(
        previousData[previousIndex + 2] - currentData[currentIndex + 2]
      );
      samples += 1;
    }
  }

  return samples === 0 ? Number.POSITIVE_INFINITY : diff / samples / 3;
}

function findVerticalScrollOffset(
  previousFrame: HTMLCanvasElement,
  currentFrame: HTMLCanvasElement
) {
  const width = Math.min(previousFrame.width, currentFrame.width);
  const height = Math.min(previousFrame.height, currentFrame.height);
  const minOverlap = Math.max(
    LONG_CAPTURE_MIN_OVERLAP,
    Math.floor(height * LONG_CAPTURE_MIN_OVERLAP_RATIO)
  );
  const maxOffset = height - minOverlap;
  const minShift = Math.max(
    1,
    Math.floor(height * LONG_CAPTURE_MIN_SHIFT_RATIO)
  );
  if (width <= 0 || maxOffset < 1) {
    return {
      offset: 0,
      minShift,
      overlap: 0,
      score: Number.POSITIVE_INFINITY,
      matched: false,
      tooSmall: false,
    };
  }

  const previousContext = previousFrame.getContext("2d");
  const currentContext = currentFrame.getContext("2d");
  if (!previousContext || !currentContext) {
    return {
      offset: 0,
      minShift,
      overlap: 0,
      score: Number.POSITIVE_INFINITY,
      matched: false,
      tooSmall: false,
    };
  }

  const previousData = previousContext.getImageData(
    0,
    0,
    width,
    previousFrame.height
  ).data;
  const currentData = currentContext.getImageData(
    0,
    0,
    width,
    currentFrame.height
  ).data;
  const scoreOffset = (offset: number) => {
    const overlap = height - offset;
    const score = scoreVerticalOverlap(
      previousData,
      currentData,
      width,
      previousFrame.height,
      overlap
    );
    return {
      offset,
      overlap,
      score,
      adjustedScore:
        score + (offset / Math.max(1, height)) * LONG_CAPTURE_OFFSET_SCORE_BIAS,
    };
  };

  const coarseStep = Math.max(1, Math.floor(height / 120));
  let bestOffset = 0;
  let bestOverlap = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAdjustedScore = Number.POSITIVE_INFINITY;

  const consider = (candidate: ReturnType<typeof scoreOffset>) => {
    if (
      candidate.adjustedScore < bestAdjustedScore ||
      (candidate.adjustedScore === bestAdjustedScore &&
        candidate.offset < bestOffset)
    ) {
      bestAdjustedScore = candidate.adjustedScore;
      bestScore = candidate.score;
      bestOffset = candidate.offset;
      bestOverlap = candidate.overlap;
    }
  };

  for (let offset = 1; offset <= maxOffset; offset += coarseStep) {
    consider(scoreOffset(offset));
  }

  const fineStart = Math.max(1, bestOffset - coarseStep);
  const fineEnd = Math.min(maxOffset, bestOffset + coarseStep);
  for (let offset = fineStart; offset <= fineEnd; offset += 1) {
    consider(scoreOffset(offset));
  }

  const matched = bestScore <= LONG_CAPTURE_MATCH_THRESHOLD;

  return {
    offset: bestOffset,
    minShift,
    overlap: bestOverlap,
    score: bestScore,
    matched,
    tooSmall: matched && bestOffset < minShift,
  };
}

function normalizeBounds(start: Point, end: Point): Bounds {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function roundBounds(bounds: Bounds): Bounds {
  return {
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function clampBoundsToSelection(
  bounds: Bounds,
  selection: Bounds
): Bounds | null {
  const left = Math.max(bounds.left, selection.left);
  const top = Math.max(bounds.top, selection.top);
  const right = Math.min(
    bounds.left + bounds.width,
    selection.left + selection.width
  );
  const bottom = Math.min(
    bounds.top + bounds.height,
    selection.top + selection.height
  );
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function pointInBounds(point: Point, bounds: Bounds) {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y <= bounds.top + bounds.height
  );
}

function getLongCapturePanelBounds(bounds: Bounds): Bounds {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = bounds.left + bounds.width + LONG_CAPTURE_PANEL_GAP;
  if (
    left + LONG_CAPTURE_PANEL_WIDTH + LONG_CAPTURE_PANEL_MARGIN >
    viewportWidth
  ) {
    left = bounds.left - LONG_CAPTURE_PANEL_WIDTH - LONG_CAPTURE_PANEL_GAP;
  }
  if (left < LONG_CAPTURE_PANEL_MARGIN) {
    left = Math.max(
      LONG_CAPTURE_PANEL_MARGIN,
      Math.min(
        viewportWidth - LONG_CAPTURE_PANEL_WIDTH - LONG_CAPTURE_PANEL_MARGIN,
        bounds.left + bounds.width - LONG_CAPTURE_PANEL_WIDTH
      )
    );
  }

  const top = Math.max(
    LONG_CAPTURE_PANEL_MARGIN,
    Math.min(
      viewportHeight - LONG_CAPTURE_PANEL_HEIGHT - LONG_CAPTURE_PANEL_MARGIN,
      bounds.top + (bounds.height - LONG_CAPTURE_PANEL_HEIGHT) / 2
    )
  );

  return {
    left,
    top,
    width: LONG_CAPTURE_PANEL_WIDTH,
    height: LONG_CAPTURE_PANEL_HEIGHT,
  };
}

function getOcrPanelBounds(bounds: Bounds): Bounds {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = bounds.left + bounds.width + OCR_PANEL_GAP;
  if (left + OCR_PANEL_WIDTH + OCR_PANEL_MARGIN > viewportWidth) {
    left = bounds.left - OCR_PANEL_WIDTH - OCR_PANEL_GAP;
  }
  if (left < OCR_PANEL_MARGIN) {
    left = Math.max(
      OCR_PANEL_MARGIN,
      viewportWidth - OCR_PANEL_WIDTH - OCR_PANEL_MARGIN
    );
  }

  const top = Math.max(
    OCR_PANEL_MARGIN,
    Math.min(
      viewportHeight - OCR_PANEL_HEIGHT - OCR_PANEL_MARGIN,
      bounds.top + (bounds.height - OCR_PANEL_HEIGHT) / 2
    )
  );

  return {
    left,
    top,
    width: OCR_PANEL_WIDTH,
    height: OCR_PANEL_HEIGHT,
  };
}

function getDefaultOcrTargetLanguage() {
  const language = getSettings().language;
  return language === "zh-CN" ? "zh-CN" : "en";
}

function getStoredOcrTargetLanguage() {
  if (typeof localStorage === "undefined") return getDefaultOcrTargetLanguage();
  const stored = localStorage.getItem(OCR_TARGET_LANGUAGE_STORAGE_KEY);
  return TRANSLATION_LANGUAGES.some((language) => language.code === stored)
    ? stored || getDefaultOcrTargetLanguage()
    : getDefaultOcrTargetLanguage();
}

function setStoredOcrTargetLanguage(language: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(OCR_TARGET_LANGUAGE_STORAGE_KEY, language);
}

function getOcrCopyText(result: OcrScanResult | null) {
  if (!result) return "";
  const text = result.text.trim();
  if (text) return result.text;
  return result.qrCodes.map((qrCode) => qrCode.value).join("\n");
}

async function translateTexts(texts: string[], targetLang: string) {
  return invoke<string[]>("translate_texts", { texts, targetLang });
}

function getHandleCursor(handle: ResizeHandle) {
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  return "nesw-resize";
}

function getHandlePoint(handle: ResizeHandle, bounds: Bounds): Point {
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;

  const positions: Record<ResizeHandle, Point> = {
    n: { x: centerX, y: bounds.top },
    s: { x: centerX, y: bottom },
    e: { x: right, y: centerY },
    w: { x: bounds.left, y: centerY },
    nw: { x: bounds.left, y: bounds.top },
    ne: { x: right, y: bounds.top },
    sw: { x: bounds.left, y: bottom },
    se: { x: right, y: bottom },
  };

  return positions[handle];
}

function getResizeHandleAtPoint(
  point: Point,
  bounds: Bounds
): ResizeHandle | null {
  const cornerHandles: ResizeHandle[] = ["nw", "ne", "se", "sw"];
  for (const handle of cornerHandles) {
    const handlePoint = getHandlePoint(handle, bounds);
    if (
      Math.abs(point.x - handlePoint.x) <= SELECTION_HANDLE_HIT_SIZE &&
      Math.abs(point.y - handlePoint.y) <= SELECTION_HANDLE_HIT_SIZE
    ) {
      return handle;
    }
  }

  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const withinX =
    point.x >= bounds.left - SELECTION_EDGE_HIT_SIZE &&
    point.x <= right + SELECTION_EDGE_HIT_SIZE;
  const withinY =
    point.y >= bounds.top - SELECTION_EDGE_HIT_SIZE &&
    point.y <= bottom + SELECTION_EDGE_HIT_SIZE;

  if (withinX && Math.abs(point.y - bounds.top) <= SELECTION_EDGE_HIT_SIZE) {
    return "n";
  }
  if (withinX && Math.abs(point.y - bottom) <= SELECTION_EDGE_HIT_SIZE) {
    return "s";
  }
  if (withinY && Math.abs(point.x - right) <= SELECTION_EDGE_HIT_SIZE) {
    return "e";
  }
  if (withinY && Math.abs(point.x - bounds.left) <= SELECTION_EDGE_HIT_SIZE) {
    return "w";
  }

  return null;
}

function clampMoveBounds(
  bounds: Bounds,
  canvas: fabric.Canvas,
  limitBounds: Bounds = {
    left: 0,
    top: 0,
    width: canvas.getWidth(),
    height: canvas.getHeight(),
  }
): Bounds {
  const maxLeft = Math.max(
    limitBounds.left,
    limitBounds.left + limitBounds.width - bounds.width
  );
  const maxTop = Math.max(
    limitBounds.top,
    limitBounds.top + limitBounds.height - bounds.height
  );

  return {
    ...bounds,
    left: Math.min(Math.max(limitBounds.left, bounds.left), maxLeft),
    top: Math.min(Math.max(limitBounds.top, bounds.top), maxTop),
  };
}

function clampPointToCanvas(point: Point, canvas: fabric.Canvas): Point {
  return {
    x: Math.min(Math.max(0, point.x), canvas.getWidth()),
    y: Math.min(Math.max(0, point.y), canvas.getHeight()),
  };
}

function computeResizeBounds(
  handle: ResizeHandle,
  initial: Bounds,
  start: Point,
  current: Point,
  canvas: fabric.Canvas,
  limitBounds: Bounds = {
    left: 0,
    top: 0,
    width: canvas.getWidth(),
    height: canvas.getHeight(),
  }
): Bounds {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  let left = initial.left;
  let top = initial.top;
  let right = initial.left + initial.width;
  let bottom = initial.top + initial.height;

  if (handle.includes("w")) left += deltaX;
  if (handle.includes("e")) right += deltaX;
  if (handle.includes("n")) top += deltaY;
  if (handle.includes("s")) bottom += deltaY;

  const minLeft = limitBounds.left;
  const minTop = limitBounds.top;
  const maxRight = limitBounds.left + limitBounds.width;
  const maxBottom = limitBounds.top + limitBounds.height;

  left = Math.min(Math.max(minLeft, left), maxRight);
  right = Math.min(Math.max(minLeft, right), maxRight);
  top = Math.min(Math.max(minTop, top), maxBottom);
  bottom = Math.min(Math.max(minTop, bottom), maxBottom);

  if (right - left < MIN_SELECTION_SIZE) {
    if (handle.includes("w")) left = right - MIN_SELECTION_SIZE;
    else right = left + MIN_SELECTION_SIZE;
  }

  if (bottom - top < MIN_SELECTION_SIZE) {
    if (handle.includes("n")) top = bottom - MIN_SELECTION_SIZE;
    else bottom = top + MIN_SELECTION_SIZE;
  }

  if (left < minLeft) left = minLeft;
  if (top < minTop) top = minTop;
  if (right > maxRight) right = maxRight;
  if (bottom > maxBottom) bottom = maxBottom;

  return {
    left,
    top,
    width: Math.max(MIN_SELECTION_SIZE, right - left),
    height: Math.max(MIN_SELECTION_SIZE, bottom - top),
  };
}

function makeArrowPath(
  start: Point,
  end: Point,
  color: string,
  strokeWidth: number
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(14, strokeWidth * 4);
  const headAngle = Math.PI / 7;
  const headA = {
    x: end.x - headLength * Math.cos(angle - headAngle),
    y: end.y - headLength * Math.sin(angle - headAngle),
  };
  const headB = {
    x: end.x - headLength * Math.cos(angle + headAngle),
    y: end.y - headLength * Math.sin(angle + headAngle),
  };

  return new fabric.Path(
    `M ${start.x} ${start.y} L ${end.x} ${end.y} M ${headA.x} ${headA.y} L ${end.x} ${end.y} L ${headB.x} ${headB.y}`,
    {
      fill: "",
      stroke: color,
      strokeLineCap: "round",
      strokeLineJoin: "round",
      strokeWidth,
      selectable: false,
      evented: false,
    }
  );
}

function getAnnotationData(object: fabric.Object | null | undefined) {
  return (object as fabric.Object & { data?: AnnotationData })?.data;
}

function isAnnotation(object: fabric.Object) {
  return getAnnotationData(object)?.role === "annotation";
}

export default function ScreenshotWindow() {
  const { t } = useTranslation();
  const currentWindowLabelRef = useRef(getCurrentWindow().label);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const longCapturePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const longCapturePanelRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const bgImgRef = useRef<fabric.FabricImage | null>(null);
  const selectionImgRef = useRef<fabric.FabricImage | null>(null);
  const selectionBorderRef = useRef<fabric.Rect | null>(null);
  const maskRef = useRef<fabric.Rect | null>(null);
  const longCaptureFrameRef = useRef<fabric.Rect | null>(null);
  const selectionBoundsRef = useRef<Bounds | null>(null);
  const scaleRef = useRef(1);
  const longCaptureBoundsRef = useRef<Bounds | null>(null);
  const longCaptureResultCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const longCaptureLastFrameRef = useRef<HTMLCanvasElement | null>(null);
  const longCaptureResultBlobRef = useRef<Blob | null>(null);
  const longCaptureResultUrlRef = useRef<string | null>(null);
  const longCaptureBusyRef = useRef(false);
  const longCaptureActiveRef = useRef(false);
  const longCaptureShortcutsRegisteredRef = useRef(false);
  const longCaptureScrollTimerRef = useRef<number | null>(null);
  const longCaptureSnapshotHiddenRef = useRef(false);
  const longCapturePendingAppendRef = useRef(false);
  const longCaptureWindowOriginRef = useRef<Point>({ x: 0, y: 0 });
  const longCaptureRectCaptureFailedRef = useRef(false);
  const longCaptureLastScrollCaptureAtRef = useRef(0);
  const currentCaptureMonitorRef = useRef<CaptureStartPayload | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const windowRegionsRef = useRef<CaptureWindowRegion[]>([]);
  const hoverWindowRef = useRef<CaptureWindowRegion | null>(null);
  const draftObjectRef = useRef<fabric.Object | null>(null);
  const selectedAnnotationRef = useRef<fabric.Object | null>(null);
  const selectionHandleRefs = useRef<
    Partial<Record<ResizeHandle, fabric.Rect>>
  >({});
  const isDraggingRef = useRef(false);
  const activeToolRef = useRef<EditorTool>("select");
  const strokeColorRef = useRef("#ff4d4f");
  const strokeWidthRef = useRef(DEFAULT_STROKE_WIDTH);
  const textSizeRef = useRef(DEFAULT_TEXT_SIZE);
  const markerColorRef = useRef("#1677ff");
  const markerNumberRef = useRef(1);
  const undoStackRef = useRef<HistoryAction[]>([]);
  const redoStackRef = useRef<HistoryAction[]>([]);
  const removedDuringStrokeRef = useRef<Set<fabric.Object>>(new Set());

  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [selectionReady, setSelectionReady] = useState(false);
  const [strokeColor, setStrokeColor] = useState("#ff4d4f");
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_WIDTH);
  const [textSize, setTextSize] = useState(DEFAULT_TEXT_SIZE);
  const [markerColor, setMarkerColor] = useState("#1677ff");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [selectedAnnotationRevision, setSelectedAnnotationRevision] =
    useState(0);
  const [ocrPanel, setOcrPanel] = useState<OcrPanelState>(() => ({
    status: "idle",
    targetLang: getStoredOcrTargetLanguage(),
    result: null,
    displayText: "",
    error: null,
    showingTranslation: false,
  }));
  const [translationOverlayBusy, setTranslationOverlayBusy] = useState(false);
  const [longCapture, setLongCapture] = useState<LongCaptureState>({
    status: "idle",
    frameCount: 0,
    height: 0,
    messageKey: null,
  });
  const [toolbarPosition, setToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const canUndo = historyRevision >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyRevision >= 0 && redoStackRef.current.length > 0;
  const isLongCaptureActive =
    longCapture.status === "waiting" ||
    longCapture.status === "capturing" ||
    longCapture.status === "failed";
  const isLongCaptureResultReady = longCapture.status === "ready";

  useEffect(() => {
    activeToolRef.current = activeTool;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = activeTool === "pen";
    if (activeTool === "pen") {
      const brush = new fabric.PencilBrush(canvas);
      brush.color = strokeColorRef.current;
      brush.width = strokeWidthRef.current;
      canvas.freeDrawingBrush = brush;
      cursorManager.setTool(ToolType.Pen);
      return;
    }

    if (activeTool === "select") {
      cursorManager.setCursor(
        selectionBoundsRef.current ? "default" : "crosshair"
      );
    } else if (activeTool === "text") cursorManager.setTool(ToolType.Text);
    else if (activeTool === "eraser") cursorManager.setTool(ToolType.Eraser);
    else cursorManager.setCursor("crosshair");
  }, [activeTool]);

  useEffect(() => {
    strokeColorRef.current = strokeColor;
    if (
      fabricCanvasRef.current?.freeDrawingBrush &&
      activeToolRef.current === "pen"
    ) {
      fabricCanvasRef.current.freeDrawingBrush.color = strokeColor;
    }
  }, [strokeColor]);

  useEffect(() => {
    strokeWidthRef.current = strokeWidth;
    if (
      fabricCanvasRef.current?.freeDrawingBrush &&
      activeToolRef.current === "pen"
    ) {
      fabricCanvasRef.current.freeDrawingBrush.width = strokeWidth;
    }
  }, [strokeWidth]);

  useEffect(() => {
    markerColorRef.current = markerColor;
  }, [markerColor]);

  useEffect(() => {
    textSizeRef.current = textSize;
  }, [textSize]);

  useEffect(() => {
    longCaptureActiveRef.current = isLongCaptureActive;
  }, [isLongCaptureActive]);

  useEffect(() => {
    if (!isLongCaptureActive || !longCaptureResultCanvasRef.current) return;
    updateLongCaptureThumbnail(longCaptureResultCanvasRef.current);
  }, [isLongCaptureActive, longCapture.frameCount]);

  const bumpHistory = () => setHistoryRevision((value) => value + 1);

  const pushHistory = (action: HistoryAction) => {
    if (action.objects.length === 0) {
      return;
    }

    undoStackRef.current.push(action);
    redoStackRef.current = [];
    bumpHistory();
  };

  const selectAnnotation = (object: fabric.Object | null) => {
    const canvas = fabricCanvasRef.current;
    const annotation = object && isAnnotation(object) ? object : null;

    selectedAnnotationRef.current = annotation;
    if (annotation) {
      const data = getAnnotationData(annotation);
      if (data?.tool === "sequence" && data.color) {
        setMarkerColor(data.color);
      } else if (data?.tool === "text") {
        if (data.color) setStrokeColor(data.color);
        if (data.fontSize) setTextSize(data.fontSize);
      } else {
        if (data?.color) setStrokeColor(data.color);
        if (data?.strokeWidth) setStrokeWidth(data.strokeWidth);
      }
      if (canvas?.getActiveObject() !== annotation) {
        canvas?.setActiveObject(annotation);
      }
    } else {
      if (canvas?.getActiveObject()) {
        canvas?.discardActiveObject();
      }
    }

    setSelectedAnnotationRevision((value) => value + 1);
    canvas?.requestRenderAll();
  };

  const getSelectedAnnotationTool = () =>
    getAnnotationData(selectedAnnotationRef.current)?.tool;

  const isScreenshotTextEditing = () => {
    const canvas = fabricCanvasRef.current;
    const object = canvas?.getActiveObject() ?? selectedAnnotationRef.current;
    return Boolean(
      object &&
      "isEditing" in object &&
      (object as fabric.Object & { isEditing?: boolean }).isEditing
    );
  };

  const applyStrokeColor = (color: string) => {
    setStrokeColor(color);
    strokeColorRef.current = color;

    const object = selectedAnnotationRef.current;
    const tool = getSelectedAnnotationTool();
    if (!object || (!isStrokeTool(tool) && !isTextTool(tool))) return;

    object.set(isTextTool(tool) ? "fill" : "stroke", color);
    const data = getAnnotationData(object);
    if (data) data.color = color;
    fabricCanvasRef.current?.requestRenderAll();
  };

  const applyStrokeWidth = (width: number) => {
    setStrokeWidth(width);
    strokeWidthRef.current = width;

    const object = selectedAnnotationRef.current;
    if (!object || !isStrokeTool(getSelectedAnnotationTool())) return;

    object.set("strokeWidth", width);
    const data = getAnnotationData(object);
    if (data) data.strokeWidth = width;
    fabricCanvasRef.current?.requestRenderAll();
  };

  const applyTextSize = (size: number) => {
    setTextSize(size);
    textSizeRef.current = size;

    const object = selectedAnnotationRef.current;
    if (!object || getSelectedAnnotationTool() !== "text") return;

    object.set("fontSize", size);
    const data = getAnnotationData(object);
    if (data) data.fontSize = size;
    object.setCoords();
    fabricCanvasRef.current?.requestRenderAll();
  };

  const applyMarkerColor = (color: string) => {
    setMarkerColor(color);
    markerColorRef.current = color;

    const object = selectedAnnotationRef.current;
    if (!object || getSelectedAnnotationTool() !== "sequence") return;

    const markerObjects =
      "getObjects" in object && typeof object.getObjects === "function"
        ? object.getObjects()
        : [];
    markerObjects[0]?.set("fill", color);
    const data = getAnnotationData(object);
    if (data) data.color = color;
    fabricCanvasRef.current?.requestRenderAll();
  };

  const clampAnnotationToSelection = (object: fabric.Object) => {
    const selection = selectionBoundsRef.current;
    if (!selection || !isAnnotation(object)) return;

    const bounds = object.getBoundingRect();
    let nextLeft = object.left ?? bounds.left;
    let nextTop = object.top ?? bounds.top;

    if (bounds.left < selection.left) {
      nextLeft += selection.left - bounds.left;
    }
    if (bounds.top < selection.top) {
      nextTop += selection.top - bounds.top;
    }
    if (bounds.left + bounds.width > selection.left + selection.width) {
      nextLeft -= bounds.left + bounds.width - selection.left - selection.width;
    }
    if (bounds.top + bounds.height > selection.top + selection.height) {
      nextTop -= bounds.top + bounds.height - selection.top - selection.height;
    }

    object.set({ left: nextLeft, top: nextTop });
    object.setCoords();
  };

  const getSourceDisplayBounds = (): Bounds | null => {
    const image = bgImgRef.current;
    const canvas = fabricCanvasRef.current;
    if (!image) {
      return canvas
        ? {
            left: 0,
            top: 0,
            width: canvas.getWidth(),
            height: canvas.getHeight(),
          }
        : null;
    }

    return {
      left: image.left ?? 0,
      top: image.top ?? 0,
      width: image.getScaledWidth(),
      height: image.getScaledHeight(),
    };
  };

  const getSelectionLimitBounds = (canvas: fabric.Canvas) =>
    getSourceDisplayBounds() ?? {
      left: 0,
      top: 0,
      width: canvas.getWidth(),
      height: canvas.getHeight(),
    };

  const calculateToolbarPosition = (bounds: Bounds) => {
    const toolbarWidth =
      toolbarRef.current?.offsetWidth || DEFAULT_TOOLBAR_WIDTH;
    const toolbarHeight =
      toolbarRef.current?.offsetHeight || DEFAULT_TOOLBAR_HEIGHT;
    const minLeft = toolbarWidth / 2 + TOOLBAR_MARGIN;
    const maxLeft = window.innerWidth - toolbarWidth / 2 - TOOLBAR_MARGIN;
    const center = bounds.left + bounds.width / 2;
    const left =
      maxLeft >= minLeft
        ? Math.min(Math.max(center, minLeft), maxLeft)
        : window.innerWidth / 2;
    let top = bounds.top + bounds.height + 8;

    if (top + toolbarHeight + TOOLBAR_MARGIN > window.innerHeight) {
      top = bounds.top - toolbarHeight - 8;
    }

    top = Math.min(
      Math.max(TOOLBAR_SAFE_TOP, top),
      Math.max(
        TOOLBAR_SAFE_TOP,
        window.innerHeight - toolbarHeight - TOOLBAR_MARGIN
      )
    );

    return { left, top };
  };

  const syncToolbarPosition = (bounds: Bounds) => {
    const next = calculateToolbarPosition(bounds);
    setToolbarPosition((current) => {
      if (
        current &&
        Math.round(current.left) === Math.round(next.left) &&
        Math.round(current.top) === Math.round(next.top)
      ) {
        return current;
      }

      return next;
    });
  };

  const ensureSelectionHandles = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    RESIZE_HANDLES.forEach((handle) => {
      if (selectionHandleRefs.current[handle]) return;

      const rect = new fabric.Rect({
        width: SELECTION_HANDLE_SIZE,
        height: SELECTION_HANDLE_SIZE,
        fill: "#ffffff",
        stroke: "#1677ff",
        strokeWidth: 1.5,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
        visible: false,
        objectCaching: false,
      });
      (
        rect as fabric.Rect & { data?: { role: string; handle: ResizeHandle } }
      ).data = {
        role: "selection-handle",
        handle,
      };
      selectionHandleRefs.current[handle] = rect;
      canvas.add(rect);
    });
  };

  const bringSelectionHandlesToFront = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const border = selectionBorderRef.current;
    if (border) canvas.bringObjectToFront(border);
    RESIZE_HANDLES.forEach((handle) => {
      const object = selectionHandleRefs.current[handle];
      if (object) canvas.bringObjectToFront(object);
    });
  };

  const setSelectionHandlesVisible = (visible: boolean) => {
    RESIZE_HANDLES.forEach((handle) => {
      selectionHandleRefs.current[handle]?.set("visible", visible);
    });
  };

  const syncSelectionBorder = (bounds: Bounds, visible = true) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    let border = selectionBorderRef.current;
    if (!border) {
      border = new fabric.Rect({
        fill: "rgba(0, 0, 0, 0)",
        stroke: "#1677ff",
        strokeWidth: SELECTION_BORDER_WIDTH,
        strokeUniform: true,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
        objectCaching: false,
        visible: false,
      });
      selectionBorderRef.current = border;
      canvas.add(border);
    }

    border.set({
      left: bounds.left + bounds.width / 2,
      top: bounds.top + bounds.height / 2,
      width: Math.max(0, bounds.width - SELECTION_BORDER_WIDTH),
      height: Math.max(0, bounds.height - SELECTION_BORDER_WIDTH),
      visible,
    });
    border.setCoords();
    canvas.bringObjectToFront(border);
  };

  const syncSelectionHandles = (bounds: Bounds) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    ensureSelectionHandles();
    RESIZE_HANDLES.forEach((handle) => {
      const object = selectionHandleRefs.current[handle];
      const point = getHandlePoint(handle, bounds);
      object?.set({
        left: point.x,
        top: point.y,
        visible: true,
      });
      object?.setCoords();
    });
    bringSelectionHandlesToFront();
  };

  const refreshAnnotationClipPaths = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.getObjects().forEach((object) => {
      if (isAnnotation(object)) object.clipPath = makeSelectionClipPath();
    });
  };

  const mapCaptureWindowsToCanvas = (
    windows: RawCaptureWindowRegion[],
    canvas: fabric.Canvas
  ): CaptureWindowRegion[] => {
    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    return windows
      .map((window) => {
        const scaleX = canvasWidth / window.monitor_width;
        const scaleY = canvasHeight / window.monitor_height;

        return {
          id: window.id,
          left: window.x * scaleX,
          top: window.y * scaleY,
          width: window.width * scaleX,
          height: window.height * scaleY,
          pid: window.pid,
          title: window.title,
          appName: window.app_name,
          isFullscreenLike: window.is_fullscreen_like,
          isOverlayCandidate: window.is_overlay_candidate,
          isFocused: window.is_focused,
        };
      })
      .filter(
        (window) =>
          window.width >= MIN_SELECTION_SIZE &&
          window.height >= MIN_SELECTION_SIZE
      );
  };

  const getWindowAtPoint = (point: Point) =>
    getBestWindowMatch(
      point,
      windowRegionsRef.current,
      fabricCanvasRef.current
    );

  const updateLongCaptureWindowOrigin = async () => {
    const monitor = currentCaptureMonitorRef.current;
    if (monitor && monitor.label === currentWindowLabelRef.current) {
      longCaptureWindowOriginRef.current = {
        x: monitor.x,
        y: monitor.y,
      };
      return;
    }

    const win = getCurrentWindow();
    const [position, scaleFactor] = await Promise.all([
      win.innerPosition(),
      win.scaleFactor(),
    ]);
    const logicalPosition = position.toLogical(scaleFactor);
    longCaptureWindowOriginRef.current = {
      x: logicalPosition.x,
      y: logicalPosition.y,
    };
  };

  const getBestWindowMatch = (
    point: Point,
    windows: CaptureWindowRegion[],
    canvas: fabric.Canvas | null
  ) => {
    const matches = windows.filter((window) => pointInBounds(point, window));
    if (matches.length === 0) return null;
    if (!canvas || matches.length === 1) return matches[0];

    const canvasArea = canvas.getWidth() * canvas.getHeight();
    const sortedMatches = [...matches].sort((a, b) => {
      if (a.isOverlayCandidate !== b.isOverlayCandidate) {
        return a.isOverlayCandidate ? 1 : -1;
      }
      if (a.isFocused !== b.isFocused) return a.isFocused ? -1 : 1;

      const aArea = a.width * a.height;
      const bArea = b.width * b.height;
      const aIsWholeScreen = aArea / canvasArea >= 0.96;
      const bIsWholeScreen = bArea / canvasArea >= 0.96;
      if (aIsWholeScreen !== bIsWholeScreen) return aIsWholeScreen ? 1 : -1;

      return aArea - bArea;
    });

    return sortedMatches[0];
  };

  const clearHoverWindowPreview = () => {
    hoverWindowRef.current = null;
    if (!selectionBoundsRef.current) {
      selectionImgRef.current?.set("visible", false);
      selectionBorderRef.current?.set("visible", false);
      fabricCanvasRef.current?.requestRenderAll();
    }
  };

  const previewHoverWindowAtPoint = (point: Point) => {
    const canvas = fabricCanvasRef.current;
    if (
      !canvas ||
      activeToolRef.current !== "select" ||
      isDraggingRef.current ||
      selectionBoundsRef.current ||
      longCaptureActiveRef.current
    ) {
      return;
    }

    const hoveredWindow = getWindowAtPoint(clampPointToCanvas(point, canvas));
    if (hoveredWindow) {
      hoverWindowRef.current = hoveredWindow;
      updateSelection(hoveredWindow);
    } else {
      clearHoverWindowPreview();
    }
    cursorManager.setCursor("crosshair");
  };

  const makeSelectionClipPath = () => {
    const bounds = selectionBoundsRef.current;
    if (!bounds) return undefined;

    const clip = new fabric.Rect({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      selectable: false,
      evented: false,
    });
    (
      clip as fabric.Rect & { absolutePositioned?: boolean }
    ).absolutePositioned = true;
    return clip;
  };

  const markAnnotation = <T extends fabric.Object>(
    object: T,
    data: Omit<AnnotationData, "role">
  ) => {
    object.set({
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: true,
      lockMovementX: false,
      lockMovementY: false,
      borderColor: "#1677ff",
      cornerColor: "#1677ff",
      hoverCursor: "pointer",
      objectCaching: false,
    });
    (object as T & { data?: AnnotationData }).data = {
      role: "annotation",
      ...data,
    };
    object.clipPath = makeSelectionClipPath();
    return object;
  };

  const clearAnnotations = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.getObjects().forEach((object) => {
      if (isAnnotation(object)) canvas.remove(object);
    });
    selectAnnotation(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    markerNumberRef.current = 1;
    bumpHistory();
  };

  const clearOcrResult = () => {
    setOcrPanel((current) => ({
      status: "idle",
      targetLang: current.targetLang,
      result: null,
      displayText: "",
      error: null,
      showingTranslation: false,
    }));
  };

  const resetEditor = () => {
    const canvas = fabricCanvasRef.current;
    canvas?.clear();
    clearLongCaptureScrollTimer();
    longCaptureSnapshotHiddenRef.current = false;
    document.body.classList.remove("long-capture-snapshot-mode");
    document.body.classList.remove("long-capture-panel-snapshot-mode");
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    if (longCaptureResultUrlRef.current) {
      URL.revokeObjectURL(longCaptureResultUrlRef.current);
    }

    sourceUrlRef.current = null;
    sourceImageRef.current = null;
    bgImgRef.current = null;
    selectionImgRef.current = null;
    selectionBorderRef.current = null;
    maskRef.current = null;
    longCaptureFrameRef.current = null;
    selectionBoundsRef.current = null;
    dragStartRef.current = null;
    selectionDragRef.current = null;
    windowRegionsRef.current = [];
    hoverWindowRef.current = null;
    longCaptureBoundsRef.current = null;
    longCaptureResultCanvasRef.current = null;
    longCaptureLastFrameRef.current = null;
    longCaptureResultBlobRef.current = null;
    longCaptureResultUrlRef.current = null;
    longCaptureBusyRef.current = false;
    longCaptureActiveRef.current = false;
    longCaptureShortcutsRegisteredRef.current = false;
    longCapturePendingAppendRef.current = false;
    longCaptureWindowOriginRef.current = { x: 0, y: 0 };
    longCaptureRectCaptureFailedRef.current = false;
    longCaptureLastScrollCaptureAtRef.current = 0;
    draftObjectRef.current = null;
    selectedAnnotationRef.current = null;
    selectionHandleRefs.current = {};
    isDraggingRef.current = false;
    markerNumberRef.current = 1;
    undoStackRef.current = [];
    redoStackRef.current = [];
    setToolbarPosition(null);
    setSelectionReady(false);
    setActiveTool("select");
    clearOcrResult();
    setTranslationOverlayBusy(false);
    setLongCapture({
      status: "idle",
      frameCount: 0,
      height: 0,
      messageKey: null,
    });
    const previewCanvas = longCapturePreviewCanvasRef.current;
    const previewContext = previewCanvas?.getContext("2d");
    if (previewCanvas && previewContext) {
      previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    setSelectedAnnotationRevision((value) => value + 1);
    bumpHistory();
  };

  const addAnnotation = (
    object: fabric.Object,
    data: Omit<AnnotationData, "role">
  ) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    markAnnotation(object, data);
    canvas.add(object);
    bringSelectionHandlesToFront();
    canvas.requestRenderAll();
    pushHistory({ type: "add", objects: [object] });
  };

  const createMosaicImage = async (bounds: Bounds) => {
    const sourceImage = sourceImageRef.current;
    if (!sourceImage) return null;

    const scale = scaleRef.current;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const sourceX = Math.round(bounds.left / scale);
    const sourceY = Math.round(bounds.top / scale);
    const sourceWidth = Math.max(1, Math.round(bounds.width / scale));
    const sourceHeight = Math.max(1, Math.round(bounds.height / scale));
    const tiny = document.createElement("canvas");
    const output = document.createElement("canvas");
    const tinyContext = tiny.getContext("2d");
    const outputContext = output.getContext("2d");

    if (!tinyContext || !outputContext) return null;

    tiny.width = Math.max(1, Math.ceil(width / MOSAIC_BLOCK_SIZE));
    tiny.height = Math.max(1, Math.ceil(height / MOSAIC_BLOCK_SIZE));
    output.width = width;
    output.height = height;

    tinyContext.imageSmoothingEnabled = true;
    tinyContext.drawImage(
      sourceImage,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      tiny.width,
      tiny.height
    );
    outputContext.imageSmoothingEnabled = false;
    outputContext.drawImage(
      tiny,
      0,
      0,
      tiny.width,
      tiny.height,
      0,
      0,
      width,
      height
    );

    const image = await fabric.FabricImage.fromURL(
      output.toDataURL("image/png")
    );
    image.set({
      left: bounds.left,
      top: bounds.top,
      selectable: false,
      evented: false,
    });

    return markAnnotation(image, { tool: "mosaic-rect" });
  };

  const addMosaicBounds = async (bounds: Bounds) => {
    const canvas = fabricCanvasRef.current;
    const selection = selectionBoundsRef.current;
    if (!canvas || !selection) return null;

    const clampedBounds = clampBoundsToSelection(bounds, selection);
    if (!clampedBounds) return null;

    const image = await createMosaicImage(clampedBounds);
    if (!image) return null;

    canvas.add(image);
    bringSelectionHandlesToFront();
    canvas.requestRenderAll();
    return image;
  };

  const addSequenceMarker = (point: Point) => {
    const selection = selectionBoundsRef.current;
    if (!selection || !pointInBounds(point, selection)) return;

    const number = markerNumberRef.current;
    markerNumberRef.current += 1;

    const circle = new fabric.Circle({
      left: 0,
      top: 0,
      radius: 13,
      fill: markerColorRef.current,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });
    const label = new fabric.Text(String(number), {
      left: 0,
      top: 0,
      fill: "#ffffff",
      fontSize: number > 99 ? 10 : 14,
      fontWeight: "700",
      fontFamily: "Inter, Arial, sans-serif",
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });
    const marker = new fabric.Group([circle, label], {
      left: point.x,
      top: point.y,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });

    addAnnotation(marker, { tool: "sequence", color: markerColorRef.current });
  };

  const addTextAnnotation = (point: Point) => {
    const canvas = fabricCanvasRef.current;
    const selection = selectionBoundsRef.current;
    if (!canvas || !selection || !pointInBounds(point, selection)) return;

    const text = new fabric.IText(t("screenshot.tools.textPlaceholder"), {
      left: point.x,
      top: point.y,
      fill: strokeColorRef.current,
      fontSize: textSizeRef.current,
      fontFamily: "Inter, Arial, sans-serif",
      fontWeight: "700",
      editable: true,
      selectable: true,
      evented: true,
      hasControls: false,
      lockMovementX: false,
      lockMovementY: false,
    });

    addAnnotation(text, {
      tool: "text",
      color: strokeColorRef.current,
      fontSize: textSizeRef.current,
    });
    selectAnnotation(text);
    text.enterEditing();
    text.selectAll();
  };

  const eraseAt = (point: Point) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const eraser = new fabric.Circle({
      left: point.x - ERASER_SIZE / 2,
      top: point.y - ERASER_SIZE / 2,
      radius: ERASER_SIZE / 2,
    });
    const fabricPoint = new fabric.Point(point.x, point.y);
    const targets = canvas
      .getObjects()
      .filter(
        (object) =>
          isAnnotation(object) &&
          !removedDuringStrokeRef.current.has(object) &&
          (object.intersectsWithObject(eraser) ||
            object.containsPoint(fabricPoint))
      );

    targets.forEach((object) => {
      removedDuringStrokeRef.current.add(object);
      canvas.remove(object);
    });

    if (targets.length > 0) canvas.requestRenderAll();
  };

  const undo = () => {
    const canvas = fabricCanvasRef.current;
    const action = undoStackRef.current.pop();
    if (!canvas || !action) return;

    if (action.type === "add") {
      if (
        action.objects.includes(selectedAnnotationRef.current as fabric.Object)
      ) {
        selectAnnotation(null);
      }
      action.objects.forEach((object) => canvas.remove(object));
    } else {
      action.objects.forEach((object) => canvas.add(object));
      bringSelectionHandlesToFront();
    }

    redoStackRef.current.push(action);
    canvas.requestRenderAll();
    bumpHistory();
  };

  const redo = () => {
    const canvas = fabricCanvasRef.current;
    const action = redoStackRef.current.pop();
    if (!canvas || !action) return;

    if (action.type === "add") {
      action.objects.forEach((object) => canvas.add(object));
      bringSelectionHandlesToFront();
    } else {
      if (
        action.objects.includes(selectedAnnotationRef.current as fabric.Object)
      ) {
        selectAnnotation(null);
      }
      action.objects.forEach((object) => canvas.remove(object));
    }

    undoStackRef.current.push(action);
    canvas.requestRenderAll();
    bumpHistory();
  };

  const deleteSelectedAnnotation = () => {
    const canvas = fabricCanvasRef.current;
    const object = selectedAnnotationRef.current;
    if (!canvas || !object || !isAnnotation(object)) return false;

    selectAnnotation(null);
    canvas.remove(object);
    pushHistory({ type: "remove", objects: [object] });
    canvas.requestRenderAll();
    return true;
  };

  const updateSelection = (
    bounds: Bounds,
    options: {
      commit?: boolean;
      showHandles?: boolean;
      refreshClipPaths?: boolean;
    } = {}
  ) => {
    const canvas = fabricCanvasRef.current;
    const selectionImg = selectionImgRef.current;
    const sourceBounds = getSourceDisplayBounds();
    const sourceImage = sourceImageRef.current;
    if (!canvas || !selectionImg || !sourceBounds || !sourceImage) return;

    const scale =
      sourceBounds.width /
      Math.max(1, sourceImage.naturalWidth || sourceImage.width);
    const cropX = (bounds.left - sourceBounds.left) / scale;
    const cropY = (bounds.top - sourceBounds.top) / scale;
    selectionImg.set({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width / scale,
      height: bounds.height / scale,
      cropX,
      cropY,
      visible: true,
    });
    syncSelectionBorder(bounds);

    if (options.commit) {
      selectionBoundsRef.current = bounds;
      syncToolbarPosition(bounds);
    }

    if (options.showHandles) {
      syncSelectionHandles(bounds);
    }

    if (options.refreshClipPaths) {
      refreshAnnotationClipPaths();
    }

    canvas.requestRenderAll();
  };

  const finishSelection = (bounds: Bounds) => {
    if (
      bounds.width < MIN_SELECTION_SIZE ||
      bounds.height < MIN_SELECTION_SIZE
    ) {
      selectionBoundsRef.current = null;
      selectionImgRef.current?.set("visible", false);
      selectionBorderRef.current?.set("visible", false);
      setSelectionHandlesVisible(false);
      setToolbarPosition(null);
      setSelectionReady(false);
      fabricCanvasRef.current?.requestRenderAll();
      return;
    }

    const canvas = fabricCanvasRef.current;
    const nextBounds = canvas
      ? clampMoveBounds(bounds, canvas, getSelectionLimitBounds(canvas))
      : bounds;
    selectionBoundsRef.current = nextBounds;
    updateSelection(nextBounds, {
      commit: true,
      showHandles: true,
      refreshClipPaths: true,
    });
    setSelectionReady(true);
    setActiveTool("select");
    clearOcrResult();
    requestAnimationFrame(() => syncToolbarPosition(nextBounds));
  };

  const removeDraftObject = () => {
    const canvas = fabricCanvasRef.current;
    const object = draftObjectRef.current;
    if (!canvas || !object) return;

    canvas.remove(object);
    draftObjectRef.current = null;
  };

  const renderDraftObject = (tool: EditorTool, start: Point, end: Point) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    removeDraftObject();

    const bounds = normalizeBounds(start, end);
    let object: fabric.Object | null = null;

    if (tool === "rect") {
      object = new fabric.Rect({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        fill: "transparent",
        stroke: strokeColorRef.current,
        strokeWidth: strokeWidthRef.current,
        selectable: false,
        evented: false,
      });
    } else if (tool === "line") {
      object = new fabric.Line([start.x, start.y, end.x, end.y], {
        stroke: strokeColorRef.current,
        strokeWidth: strokeWidthRef.current,
        strokeLineCap: "round",
        selectable: false,
        evented: false,
      });
    } else if (tool === "arrow") {
      object = makeArrowPath(
        start,
        end,
        strokeColorRef.current,
        strokeWidthRef.current
      );
    } else if (tool === "mosaic-rect") {
      object = new fabric.Rect({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        fill: "rgba(22, 119, 255, 0.14)",
        stroke: "#1677ff",
        strokeDashArray: [6, 4],
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
    }

    if (!object) return;

    draftObjectRef.current = object;
    canvas.add(object);
    canvas.requestRenderAll();
  };

  const finishDraftObject = async (
    tool: EditorTool,
    start: Point,
    end: Point
  ) => {
    const canvas = fabricCanvasRef.current;
    const selection = selectionBoundsRef.current;
    if (!canvas || !selection) return;

    removeDraftObject();
    const bounds = normalizeBounds(start, end);
    if (bounds.width < 3 && bounds.height < 3) return;

    if (tool === "mosaic-rect") {
      const image = await addMosaicBounds(bounds);
      if (image) pushHistory({ type: "add", objects: [image] });
      return;
    }

    let object: fabric.Object;
    if (tool === "rect") {
      object = new fabric.Rect({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        fill: "transparent",
        stroke: strokeColorRef.current,
        strokeWidth: strokeWidthRef.current,
        selectable: false,
        evented: false,
      });
    } else if (tool === "line") {
      object = new fabric.Line([start.x, start.y, end.x, end.y], {
        stroke: strokeColorRef.current,
        strokeWidth: strokeWidthRef.current,
        strokeLineCap: "round",
        selectable: false,
        evented: false,
      });
    } else {
      object = makeArrowPath(
        start,
        end,
        strokeColorRef.current,
        strokeWidthRef.current
      );
    }

    addAnnotation(object, {
      tool: tool as StrokeTool,
      color: strokeColorRef.current,
      strokeWidth: strokeWidthRef.current,
    });
  };

  const exportLongCaptureSelectionBlob = async () => {
    const result = longCaptureResultCanvasRef.current;
    const bounds = selectionBoundsRef.current;
    const sourceBounds = getSourceDisplayBounds();
    if (!result || !bounds || !sourceBounds)
      return longCaptureResultBlobRef.current;

    const scale = sourceBounds.width / Math.max(1, result.width);
    const sourceX = Math.max(
      0,
      Math.min(
        result.width - 1,
        Math.round((bounds.left - sourceBounds.left) / scale)
      )
    );
    const sourceY = Math.max(
      0,
      Math.min(
        result.height - 1,
        Math.round((bounds.top - sourceBounds.top) / scale)
      )
    );
    const sourceWidth = Math.max(
      1,
      Math.min(result.width - sourceX, Math.round(bounds.width / scale))
    );
    const sourceHeight = Math.max(
      1,
      Math.min(result.height - sourceY, Math.round(bounds.height / scale))
    );

    const output = makeCanvas(sourceWidth, sourceHeight);
    const context = output.getContext("2d");
    if (!context) return longCaptureResultBlobRef.current;

    context.drawImage(
      result,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    return canvasToBlob(output);
  };

  const exportSelectionBlob = async (
    options: { watermarked?: boolean } = {}
  ) => {
    const maybeApplyWatermarks = async (blob: Blob | null) => {
      if (!blob || !options.watermarked) return blob;
      return applyWatermarksToBlob(blob, getSettings());
    };

    if (longCaptureResultBlobRef.current) {
      return maybeApplyWatermarks(await exportLongCaptureSelectionBlob());
    }

    const canvas = fabricCanvasRef.current;
    const selectionImg = selectionImgRef.current;
    const selectionBorder = selectionBorderRef.current;
    const bounds = selectionBoundsRef.current;
    if (!canvas || !selectionImg || !bounds) return null;

    const borderWasVisible = selectionBorder?.visible ?? false;
    try {
      selectionBorder?.set("visible", false);
      setSelectionHandlesVisible(false);
      canvas.discardActiveObject();
      canvas.requestRenderAll();

      return await maybeApplyWatermarks(
        await canvas.toBlob({
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
          format: "png",
          multiplier: 1,
        })
      );
    } finally {
      selectionBorder?.set("visible", borderWasVisible);
      setSelectionHandlesVisible(true);
      syncSelectionHandles(bounds);
      canvas.requestRenderAll();
    }
  };

  const unregisterLongCaptureShortcuts = async () => {
    if (!longCaptureShortcutsRegisteredRef.current) return;

    try {
      await unregister(LONG_CAPTURE_SHORTCUTS);
    } catch (error) {
      console.warn("Failed to unregister long capture shortcuts:", error);
    } finally {
      longCaptureShortcutsRegisteredRef.current = false;
    }
  };

  const clearLongCaptureScrollTimer = () => {
    if (longCaptureScrollTimerRef.current === null) return;
    window.clearTimeout(longCaptureScrollTimerRef.current);
    longCaptureScrollTimerRef.current = null;
  };

  const setLongCaptureSnapshotHidden = async (
    hidden: boolean,
    hidePanel = false
  ) => {
    const panelHidden = hidden && hidePanel;
    const wasHidden = longCaptureSnapshotHiddenRef.current;
    const wasPanelHidden = document.body.classList.contains(
      "long-capture-panel-snapshot-mode"
    );
    if (wasHidden === hidden && wasPanelHidden === panelHidden) return;

    longCaptureSnapshotHiddenRef.current = hidden;
    document.body.classList.toggle("long-capture-snapshot-mode", hidden);
    document.body.classList.toggle(
      "long-capture-panel-snapshot-mode",
      panelHidden
    );
    await waitForNextPaint();
  };

  const stopLongCaptureNativeMode = async () => {
    await invoke("stop_long_capture_scroll_monitor").catch((error) => {
      console.warn("Failed to stop long capture scroll monitor:", error);
    });
    await invoke("set_screenshot_mouse_passthrough", {
      windowLabel: currentWindowLabelRef.current,
      enabled: false,
    }).catch((error) => {
      console.warn("Failed to restore screenshot mouse passthrough:", error);
    });
    await getCurrentWindow()
      .setIgnoreCursorEvents(false)
      .catch(() => {});
  };

  const closeCapture = async () => {
    clearLongCaptureScrollTimer();
    await setLongCaptureSnapshotHidden(false);
    await unregisterLongCaptureShortcuts();
    await stopLongCaptureNativeMode();
    await invoke("finish_capture");
    resetEditor();
  };

  const captureLongSelectionFrame = async (bounds: Bounds) => {
    const origin = longCaptureWindowOriginRef.current;
    const rect = {
      x: origin.x + bounds.left,
      y: origin.y + bounds.top,
      width: bounds.width,
      height: bounds.height,
    };

    try {
      const imageBytes = await invoke<ArrayBuffer>(
        "capture_screen_rect_below_screenshot_window",
        {
          windowLabel: currentWindowLabelRef.current,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }
      );
      const blob = new Blob([imageBytes], { type: "image/png" });
      const captured = await imageFromBlob(blob);
      logLongCaptureDebug("below-window rect captured", {
        rect,
        pixels: {
          width: captured.image.naturalWidth || captured.image.width,
          height: captured.image.naturalHeight || captured.image.height,
        },
      });
      return {
        frame: imageToCanvas(captured.image),
        cleanup: () => URL.revokeObjectURL(captured.url),
      };
    } catch (error) {
      if (longCaptureActiveRef.current) {
        if (!longCaptureRectCaptureFailedRef.current) {
          console.warn("Below-window rectangle capture failed:", error);
        }
        longCaptureRectCaptureFailedRef.current = true;
        throw error;
      }

      try {
        const imageBytes = await invoke<ArrayBuffer>("capture_screen_rect", {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
        const blob = new Blob([imageBytes], { type: "image/png" });
        const captured = await imageFromBlob(blob);
        logLongCaptureDebug("rect captured", {
          rect,
          pixels: {
            width: captured.image.naturalWidth || captured.image.width,
            height: captured.image.naturalHeight || captured.image.height,
          },
        });
        return {
          frame: imageToCanvas(captured.image),
          cleanup: () => URL.revokeObjectURL(captured.url),
        };
      } catch (fallbackError) {
        if (!longCaptureRectCaptureFailedRef.current) {
          console.warn("Rectangle capture failed:", fallbackError);
        }
        longCaptureRectCaptureFailedRef.current = true;
        throw fallbackError;
      }
    }
  };

  const updateLongCaptureThumbnail = (canvas: HTMLCanvasElement) => {
    const previewCanvas = longCapturePreviewCanvasRef.current;
    const context = previewCanvas?.getContext("2d");
    if (!previewCanvas || !context) return;

    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const scale = Math.min(
      previewCanvas.width / canvas.width,
      previewCanvas.height / canvas.height
    );
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const left = Math.round((previewCanvas.width - width) / 2);
    const top = Math.round((previewCanvas.height - height) / 2);

    context.drawImage(canvas, left, top, width, height);
  };

  const enterLongCaptureLiveOverlay = (bounds: Bounds) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    bgImgRef.current?.set("visible", false);
    maskRef.current?.set("visible", false);
    selectionImgRef.current?.set("visible", false);
    selectionBorderRef.current?.set("visible", false);
    setSelectionHandlesVisible(false);

    if (longCaptureFrameRef.current) {
      canvas.remove(longCaptureFrameRef.current);
    }

    const frame = new fabric.Rect({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      fill: "rgba(0, 0, 0, 0)",
      stroke: "#1677ff",
      strokeWidth: 2,
      strokeDashArray: [8, 5],
      selectable: false,
      evented: false,
    });
    longCaptureFrameRef.current = frame;
    canvas.add(frame);
    canvas.bringObjectToFront(frame);
    canvas.requestRenderAll();
  };

  const appendLongCaptureFrame = (frame: HTMLCanvasElement) => {
    const result = longCaptureResultCanvasRef.current;
    const previousFrame = longCaptureLastFrameRef.current;
    if (!result || !previousFrame) return false;

    if (frame.width !== result.width) {
      setLongCapture((current) => ({
        ...current,
        status: "failed",
        messageKey: "screenshot.longCapture.widthChanged",
      }));
      return false;
    }

    const match = findVerticalScrollOffset(previousFrame, frame);
    if (!match.matched) {
      logLongCaptureDebug("scroll offset match failed", {
        offset: match.offset,
        overlap: match.overlap,
        score: match.score,
      });
      setLongCapture((current) => ({
        ...current,
        status: "waiting",
        messageKey: "screenshot.longCapture.matchFailed",
      }));
      return false;
    }

    if (match.tooSmall) {
      logLongCaptureDebug("scroll offset below minimum", {
        offset: match.offset,
        minShift: match.minShift,
        overlap: match.overlap,
        score: match.score,
      });
      setLongCapture((current) => ({
        ...current,
        status: "waiting",
        messageKey: "screenshot.longCapture.noNewContent",
      }));
      return true;
    }

    const appendHeight = Math.max(1, match.offset - 1);
    const appendTop = Math.max(0, frame.height - appendHeight);
    longCaptureLastFrameRef.current = frame;
    logLongCaptureDebug("scroll offset matched", {
      offset: match.offset,
      minShift: match.minShift,
      overlap: match.overlap,
      score: match.score,
      appendHeight,
      resultHeight: result.height,
    });

    if (appendHeight <= 2) {
      setLongCapture((current) => ({
        ...current,
        status: "waiting",
        messageKey: "screenshot.longCapture.noNewContent",
      }));
      return true;
    }

    if (result.height + appendHeight > LONG_CAPTURE_MAX_HEIGHT) {
      setLongCapture((current) => ({
        ...current,
        status: "failed",
        messageKey: "screenshot.longCapture.tooTall",
      }));
      return false;
    }

    const nextResult = makeCanvas(result.width, result.height + appendHeight);
    const context = nextResult.getContext("2d");
    if (!context) return false;

    context.drawImage(result, 0, 0);
    context.drawImage(
      frame,
      0,
      appendTop,
      frame.width,
      appendHeight,
      0,
      result.height,
      frame.width,
      appendHeight
    );

    longCaptureResultCanvasRef.current = nextResult;
    updateLongCaptureThumbnail(nextResult);
    setLongCapture((current) => ({
      ...current,
      status: "waiting",
      frameCount: current.frameCount + 1,
      height: nextResult.height,
      messageKey: "screenshot.longCapture.appended",
    }));
    return true;
  };

  const updateLongCapturePreview = async (blob: Blob) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const previousUrl = longCaptureResultUrlRef.current;
    if (previousUrl) URL.revokeObjectURL(previousUrl);

    const { image, url } = await imageFromBlob(blob);
    longCaptureResultUrlRef.current = url;
    if (sourceUrlRef.current && sourceUrlRef.current !== url) {
      URL.revokeObjectURL(sourceUrlRef.current);
    }
    sourceImageRef.current = image;
    sourceUrlRef.current = url;

    canvas.clear();
    bgImgRef.current = null;
    selectionImgRef.current = null;
    selectionBorderRef.current = null;
    maskRef.current = null;
    longCaptureFrameRef.current = null;
    selectionHandleRefs.current = {};
    windowRegionsRef.current = [];
    hoverWindowRef.current = null;
    selectAnnotation(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    bumpHistory();

    const maxWidth = Math.max(1, canvas.getWidth() - 40);
    const maxHeight = Math.max(1, canvas.getHeight() - 96);
    const previewScale = Math.min(
      1,
      maxWidth / image.width,
      maxHeight / image.height
    );
    scaleRef.current = previewScale;

    const previewWidth = image.width * previewScale;
    const previewHeight = image.height * previewScale;
    const bounds = {
      left: (canvas.getWidth() - previewWidth) / 2,
      top: Math.max(16, (canvas.getHeight() - previewHeight) / 2 - 18),
      width: previewWidth,
      height: previewHeight,
    };

    const background = await fabric.FabricImage.fromURL(url);
    background.set({
      left: bounds.left,
      top: bounds.top,
      scaleX: previewScale,
      scaleY: previewScale,
      selectable: false,
      evented: false,
    });
    bgImgRef.current = background;
    canvas.add(background);

    const mask = new fabric.Rect({
      left: 0,
      top: 0,
      width: canvas.getWidth(),
      height: canvas.getHeight(),
      fill: "rgba(0, 0, 0, 0.52)",
      selectable: false,
      evented: false,
    });
    maskRef.current = mask;
    canvas.add(mask);

    const preview = await fabric.FabricImage.fromURL(url);
    preview.set({
      left: bounds.left,
      top: bounds.top,
      scaleX: previewScale,
      scaleY: previewScale,
      selectable: false,
      evented: false,
    });

    selectionImgRef.current = preview;
    selectionBoundsRef.current = bounds;
    canvas.add(preview);
    syncSelectionBorder(bounds);
    syncSelectionHandles(bounds);
    syncToolbarPosition(bounds);
    setSelectionReady(true);
    setActiveTool("select");
    canvas.requestRenderAll();
  };

  const finishLongCapture = async () => {
    const result = longCaptureResultCanvasRef.current;
    if (!result || longCaptureBusyRef.current) return;

    clearLongCaptureScrollTimer();
    longCaptureBusyRef.current = true;
    await unregisterLongCaptureShortcuts();
    await setLongCaptureSnapshotHidden(false);
    await stopLongCaptureNativeMode();
    setLongCapture((current) => ({
      ...current,
      status: "capturing",
      messageKey: "screenshot.longCapture.rendering",
    }));

    try {
      const blob = await canvasToBlob(result);
      if (!blob) throw new Error("Failed to render long capture");

      longCaptureResultBlobRef.current = blob;
      await invoke("ensure_screenshot_window");
      await wait(120);
      await updateLongCapturePreview(blob);
      const win = getCurrentWindow();
      await win.show().catch(() => {});
      await win.setFocus().catch(() => {});
      setLongCapture((current) => ({
        ...current,
        status: "ready",
        frameCount: current.frameCount,
        height: result.height,
        messageKey: "screenshot.longCapture.ready",
      }));
    } catch (error) {
      console.error("Failed to finish long capture:", error);
      setLongCapture((current) => ({
        ...current,
        status: "failed",
        messageKey: "screenshot.longCapture.renderFailed",
      }));
    } finally {
      longCaptureBusyRef.current = false;
    }
  };

  const captureNextLongFrame = async () => {
    const bounds = longCaptureBoundsRef.current;
    if (!bounds) return;
    if (longCaptureBusyRef.current) {
      longCapturePendingAppendRef.current = true;
      return;
    }

    longCaptureBusyRef.current = true;
    setLongCapture((current) => ({
      ...current,
      status: "capturing",
      messageKey: "screenshot.longCapture.capturing",
    }));

    let cleanupCapturedFrame: (() => void) | null = null;
    try {
      const captured = await captureLongSelectionFrame(bounds);
      cleanupCapturedFrame = captured.cleanup;
      const frame = captured.frame;
      appendLongCaptureFrame(frame);
    } catch (error) {
      console.error("Failed to append long capture frame:", error);
      setLongCapture((current) => ({
        ...current,
        status: "failed",
        messageKey: "screenshot.longCapture.captureFailed",
      }));
    } finally {
      cleanupCapturedFrame?.();
      longCaptureBusyRef.current = false;
      if (longCapturePendingAppendRef.current && longCaptureActiveRef.current) {
        longCapturePendingAppendRef.current = false;
        void captureNextLongFrame();
      }
    }
  };

  const scheduleLongCaptureAutoAppend = (
    delay = LONG_CAPTURE_SCROLL_SETTLE_DELAY
  ) => {
    clearLongCaptureScrollTimer();
    longCaptureScrollTimerRef.current = window.setTimeout(() => {
      longCaptureScrollTimerRef.current = null;
      if (!longCaptureActiveRef.current) return;
      if (longCaptureBusyRef.current) {
        longCapturePendingAppendRef.current = true;
        return;
      }
      void captureNextLongFrame();
    }, delay);
  };

  const handleLongCaptureNativeScroll = (event: LongCaptureScrollEvent) => {
    if (!longCaptureActiveRef.current) return;
    if (event.deltaX === 0 && event.deltaY === 0) return;

    setLongCapture((current) =>
      current.messageKey === "screenshot.longCapture.scrolling"
        ? current
        : {
            ...current,
            status: "waiting",
            messageKey: "screenshot.longCapture.scrolling",
          }
    );
    scheduleLongCaptureAutoAppend();

    const now = performance.now();
    if (
      now - longCaptureLastScrollCaptureAtRef.current <
      LONG_CAPTURE_MANUAL_CAPTURE_INTERVAL
    ) {
      return;
    }

    longCaptureLastScrollCaptureAtRef.current = now;
    void captureNextLongFrame();
  };

  const registerLongCaptureShortcuts = async () => {
    if (longCaptureShortcutsRegisteredRef.current) return;

    await register(LONG_CAPTURE_SHORTCUTS, async (event) => {
      if (event.state !== "Pressed") return;

      if (event.shortcut === "Enter") {
        await finishLongCapture();
      } else if (event.shortcut === "Escape") {
        await closeCapture();
      }
    });
    longCaptureShortcutsRegisteredRef.current = true;
  };

  const startLongCapture = async () => {
    const selection = selectionBoundsRef.current;
    const sourceImage = sourceImageRef.current;
    if (!selection || !sourceImage || longCaptureBusyRef.current) return;

    const captureSelection = roundBounds(selection);
    const firstFrame = cropSelectionFrame(
      sourceImage,
      captureSelection,
      scaleRef.current
    );
    if (!firstFrame) return;

    selectAnnotation(null);
    setActiveTool("select");
    setSelectionHandlesVisible(false);
    clearLongCaptureScrollTimer();
    await updateLongCaptureWindowOrigin().catch((error) => {
      console.warn("Failed to resolve screenshot window position:", error);
      longCaptureWindowOriginRef.current = { x: 0, y: 0 };
    });
    const permissionStatus = await invoke<MacosPermissionStatus>(
      "get_macos_permissions"
    ).catch(() => null);
    longCaptureResultBlobRef.current = null;
    if (longCaptureResultUrlRef.current) {
      URL.revokeObjectURL(longCaptureResultUrlRef.current);
      longCaptureResultUrlRef.current = null;
    }
    longCaptureBoundsRef.current = { ...captureSelection };
    longCapturePendingAppendRef.current = false;
    longCaptureRectCaptureFailedRef.current = false;
    longCaptureLastScrollCaptureAtRef.current = 0;
    longCaptureResultCanvasRef.current = cloneCanvas(firstFrame);
    longCaptureLastFrameRef.current = firstFrame;
    enterLongCaptureLiveOverlay(captureSelection);
    updateLongCaptureThumbnail(longCaptureResultCanvasRef.current);
    logLongCaptureDebug("started", {
      bounds: captureSelection,
      origin: longCaptureWindowOriginRef.current,
      permissions: permissionStatus,
      firstFrame: {
        width: firstFrame.width,
        height: firstFrame.height,
      },
    });
    setLongCapture({
      status: "waiting",
      frameCount: 1,
      height: firstFrame.height,
      messageKey: "screenshot.longCapture.started",
    });

    try {
      await registerLongCaptureShortcuts();
    } catch (error) {
      console.warn("Failed to register long capture shortcuts:", error);
      setLongCapture((current) => ({
        ...current,
        messageKey: "screenshot.longCapture.shortcutUnavailable",
      }));
    }

    try {
      await invoke("set_screenshot_mouse_passthrough", {
        windowLabel: currentWindowLabelRef.current,
        enabled: true,
      });
      await invoke("start_long_capture_scroll_monitor", {
        windowLabel: currentWindowLabelRef.current,
      });
    } catch (error) {
      console.warn("Failed to enter native long capture mode:", error);
      await stopLongCaptureNativeMode();
      setLongCapture((current) => ({
        ...current,
        status: "failed",
        messageKey: permissionStatus?.macos
          ? "screenshot.longCapture.accessibilityRequired"
          : "screenshot.longCapture.captureFailed",
      }));
      return;
    }

    await getCurrentWindow()
      .setFocus()
      .catch(() => {});
  };

  useEffect(() => {
    const unlisten = listen<LongCaptureScrollEvent>(
      "long-capture-scroll",
      (event) => {
        handleLongCaptureNativeScroll(event.payload);
      }
    );

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  const copyToClipboard = async () => {
    const blob = await exportSelectionBlob({ watermarked: true });
    if (!blob) return;

    const arrayBuffer = await blob.arrayBuffer();
    await invoke("copy_to_clipboard", {
      blobData: new Uint8Array(arrayBuffer),
    });
    await closeCapture();
  };

  const downloadCapture = async () => {
    const blob = await exportSelectionBlob({ watermarked: true });
    if (!blob) return;

    const arrayBuffer = await blob.arrayBuffer();
    const settings = getSettings();
    await invoke("save_to_downloads", {
      blobData: new Uint8Array(arrayBuffer),
      directory: settings.defaultSaveDirectory || null,
    });
    await closeCapture();
  };

  const pinCapture = async () => {
    const blob = await exportSelectionBlob({ watermarked: true });
    if (!blob) return;

    const arrayBuffer = await blob.arrayBuffer();
    await invoke("show_pin_window", {
      blobData: new Uint8Array(arrayBuffer),
      windowLabel: currentWindowLabelRef.current,
    });
    await closeCapture();
  };

  const setOcrTargetLang = (targetLang: string) => {
    setStoredOcrTargetLanguage(targetLang);
    setOcrPanel((current) => ({
      ...current,
      targetLang,
      displayText:
        current.result && current.showingTranslation
          ? getOcrCopyText(current.result)
          : current.displayText,
      showingTranslation: false,
    }));
  };

  const runOcrOnSelection = async (openPanel = true) => {
    if (openPanel) {
      setOcrPanel((current) => ({
        ...current,
        status: "recognizing",
        error: null,
        showingTranslation: false,
      }));
    }

    try {
      const blob = await exportSelectionBlob();
      if (!blob) throw new Error(t("screenshot.ocr.noSelection"));

      const arrayBuffer = await blob.arrayBuffer();
      const result = await invoke<OcrScanResult>("ocr_image", {
        blobData: new Uint8Array(arrayBuffer),
      });
      const displayText = getOcrCopyText(result);

      setOcrPanel((current) => ({
        ...current,
        status: "ready",
        result,
        displayText,
        error: null,
        showingTranslation: false,
      }));

      return { result, blob };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOcrPanel((current) => ({
        ...current,
        status: "failed",
        result: null,
        displayText: "",
        error: message || t("screenshot.ocr.failed"),
        showingTranslation: false,
      }));
      return null;
    }
  };

  const translateOcrPanelText = async () => {
    const result = ocrPanel.result;
    if (!result) return;

    if (ocrPanel.showingTranslation) {
      setOcrPanel((current) => ({
        ...current,
        status: "ready",
        displayText: getOcrCopyText(result),
        error: null,
        showingTranslation: false,
      }));
      return;
    }

    const originalText = getOcrCopyText(result);
    const lines = originalText.split("\n");
    setOcrPanel((current) => ({
      ...current,
      status: "translating",
      error: null,
    }));

    try {
      const translated = await translateTexts(
        lines.map((line) => line.trim()),
        ocrPanel.targetLang
      );
      const translatedText = lines
        .map((line, index) => (line.trim() ? translated[index] || "" : ""))
        .join("\n");

      setOcrPanel((current) => ({
        ...current,
        status: "ready",
        displayText: translatedText,
        error: null,
        showingTranslation: true,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOcrPanel((current) => ({
        ...current,
        status: "ready",
        error: message || t("screenshot.ocr.translateFailed"),
      }));
    }
  };

  const copyOcrText = async () => {
    const text = ocrPanel.displayText || getOcrCopyText(ocrPanel.result);
    if (!text.trim()) return;

    await invoke("copy_text_to_clipboard", { text }).catch((error) => {
      console.warn("Failed to copy OCR text:", error);
    });
  };

  const removeTranslatedOverlay = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return false;

    const objects = canvas.getObjects().filter(isTranslationOverlay);
    if (objects.length === 0) return false;

    if (objects.includes(selectedAnnotationRef.current as fabric.Object)) {
      selectAnnotation(null);
    }
    objects.forEach((object) => canvas.remove(object));
    pushHistory({ type: "remove", objects });
    canvas.requestRenderAll();
    return true;
  };

  const addTranslatedOverlay = async () => {
    if (translationOverlayBusy) return;
    if (removeTranslatedOverlay()) return;

    setTranslationOverlayBusy(true);
    setOcrPanel((current) => ({
      ...current,
      status: current.status === "idle" ? "recognizing" : "translating",
      error: null,
    }));

    let objectUrl: string | null = null;
    try {
      const blob = await exportSelectionBlob();
      if (!blob) throw new Error(t("screenshot.ocr.noSelection"));

      const arrayBuffer = await blob.arrayBuffer();
      const result = await invoke<OcrScanResult>("ocr_image", {
        blobData: new Uint8Array(arrayBuffer),
      });

      if (result.blocks.length === 0) {
        throw new Error(t("screenshot.ocr.noText"));
      }

      const translated = await translateTexts(
        result.blocks.map((block) => block.text),
        ocrPanel.targetLang
      );
      const { image, url } = await imageFromBlob(blob);
      objectUrl = url;
      const sampleCanvas = imageToCanvas(image);
      const canvas = fabricCanvasRef.current;
      const selection = selectionBoundsRef.current;
      if (!canvas || !selection) {
        throw new Error(t("screenshot.ocr.noSelection"));
      }

      const objects: fabric.Object[] = [];
      result.blocks.forEach((block, index) => {
        const translatedText = translated[index]?.trim();
        if (!translatedText) return;

        const padding = 2;
        const left = selection.left + block.bounds.x * selection.width - padding;
        const top = selection.top + block.bounds.y * selection.height - padding;
        const width = Math.max(28, block.bounds.width * selection.width + padding * 2);
        const height = Math.max(16, block.bounds.height * selection.height + padding * 2);
        const sample = sampleAverageColor(sampleCanvas, block.bounds);
        const textColor = sample.light ? "#111827" : "#ffffff";
        const fontSize = Math.max(10, Math.min(30, height * 0.68));

        const text = new fabric.Textbox(translatedText, {
          left,
          top,
          width,
          fill: textColor,
          backgroundColor: sample.color,
          fontSize,
          fontFamily: "Inter, Arial, sans-serif",
          fontWeight: "700",
          lineHeight: 1.06,
          splitByGrapheme: true,
          editable: true,
          selectable: true,
          evented: true,
          hasControls: false,
          lockMovementX: false,
          lockMovementY: false,
          padding,
          objectCaching: false,
        });

        objects.push(
          markAnnotation(text, {
            tool: "text",
            source: "translation-overlay",
            color: textColor,
            fontSize,
          })
        );
      });

      if (objects.length === 0) {
        throw new Error(t("screenshot.ocr.translateFailed"));
      }

      objects.forEach((object) => canvas.add(object));
      bringSelectionHandlesToFront();
      pushHistory({ type: "add", objects });
      canvas.requestRenderAll();
      setOcrPanel((current) => ({
        ...current,
        status: "ready",
        result,
        displayText: getOcrCopyText(result),
        error: null,
        showingTranslation: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOcrPanel((current) => ({
        ...current,
        status: "failed",
        error: message || t("screenshot.ocr.translateFailed"),
      }));
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setTranslationOverlayBusy(false);
    }
  };

  useEffect(() => {
    if (!canvasElementRef.current) return;

    const canvas = new fabric.Canvas(canvasElementRef.current, {
      selection: false,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      enableRetinaScaling: true,
    });

    canvas.setWidth(window.innerWidth);
    canvas.setHeight(window.innerHeight);

    fabricCanvasRef.current = canvas;
    cursorManager.bindCanvas(canvas);
    cursorManager.setTool(ToolType.Selection);

    const handleResize = () => {
      canvas.setWidth(window.innerWidth);
      canvas.setHeight(window.innerHeight);
    };

    const handlePathCreated = (event: { path?: fabric.Object }) => {
      const path = event.path;
      const selection = selectionBoundsRef.current;
      if (!path || !selection) return;

      const bounds = path.getBoundingRect();
      const intersects =
        bounds.left < selection.left + selection.width &&
        bounds.left + bounds.width > selection.left &&
        bounds.top < selection.top + selection.height &&
        bounds.top + bounds.height > selection.top;

      if (!intersects) {
        canvas.remove(path);
        canvas.requestRenderAll();
        return;
      }

      markAnnotation(path, {
        tool: "pen",
        color: strokeColorRef.current,
        strokeWidth: strokeWidthRef.current,
      });
      pushHistory({ type: "add", objects: [path] });
      canvas.requestRenderAll();
    };
    const handleObjectSelection = (event: { selected?: fabric.Object[] }) => {
      const object = event.selected?.find((item) => isAnnotation(item)) ?? null;
      selectAnnotation(object);
    };
    const handleSelectionCleared = () => {
      selectedAnnotationRef.current = null;
      setSelectedAnnotationRevision((value) => value + 1);
    };
    const handleObjectMoving = (event: { target?: fabric.Object }) => {
      if (!event.target) return;
      clampAnnotationToSelection(event.target);
      if (isAnnotation(event.target))
        selectedAnnotationRef.current = event.target;
    };

    window.addEventListener("resize", handleResize);
    canvas.on("path:created", handlePathCreated);
    canvas.on("selection:created", handleObjectSelection);
    canvas.on("selection:updated", handleObjectSelection);
    canvas.on("selection:cleared", handleSelectionCleared);
    canvas.on("object:moving", handleObjectMoving);

    return () => {
      window.removeEventListener("resize", handleResize);
      canvas.off("path:created", handlePathCreated);
      canvas.off("selection:created", handleObjectSelection);
      canvas.off("selection:updated", handleObjectSelection);
      canvas.off("selection:cleared", handleSelectionCleared);
      canvas.off("object:moving", handleObjectMoving);
      cursorManager.unbindCanvas();
      canvas.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
      if (longCaptureActiveRef.current) return;
      if (activeToolRef.current === "pen") return;

      const pointer = canvas.getPointer(opt.e);
      const point = clampPointToCanvas({ x: pointer.x, y: pointer.y }, canvas);
      const tool = activeToolRef.current;
      const selection = selectionBoundsRef.current;
      isDraggingRef.current = true;
      dragStartRef.current = point;

      if (opt.target && isAnnotation(opt.target)) {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        selectionDragRef.current = null;
        selectAnnotation(opt.target);
        return;
      }

      if (tool === "select") {
        selectAnnotation(null);

        if (selection) {
          const handle = getResizeHandleAtPoint(point, selection);
          if (handle) {
            selectionDragRef.current = {
              mode: "resize",
              start: point,
              initial: { ...selection },
              handle,
            };
            cursorManager.setCursor(getHandleCursor(handle));
            return;
          }

          if (pointInBounds(point, selection)) {
            selectionDragRef.current = {
              mode: "move",
              start: point,
              initial: { ...selection },
            };
            cursorManager.setCursor("move");
            return;
          }
        }

        const hoveredWindow = getWindowAtPoint(point);
        if (!selection && hoveredWindow) {
          selectionDragRef.current = {
            mode: "window",
            start: point,
            bounds: { ...hoveredWindow },
          };
          cursorManager.setCursor("crosshair");
          return;
        }

        clearAnnotations();
        selectionDragRef.current = { mode: "new", start: point };
        hoverWindowRef.current = null;
        setSelectionReady(false);
        setToolbarPosition(null);
        setSelectionHandlesVisible(false);
        selectionBoundsRef.current = null;
        updateSelection({ left: point.x, top: point.y, width: 0, height: 0 });
        return;
      }

      if (!selection) {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        return;
      }

      if (!pointInBounds(point, selection)) {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        return;
      }

      if (tool === "sequence") {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        addSequenceMarker(point);
      } else if (tool === "text") {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        addTextAnnotation(point);
      } else if (tool === "eraser") {
        removedDuringStrokeRef.current = new Set();
        eraseAt(point);
      } else {
        renderDraftObject(tool, point, point);
      }
    };

    const handleMouseMove = (opt: fabric.TPointerEventInfo) => {
      if (longCaptureActiveRef.current) return;
      if (activeToolRef.current === "pen") return;

      const pointer = canvas.getPointer(opt.e);
      const point = clampPointToCanvas({ x: pointer.x, y: pointer.y }, canvas);
      const tool = activeToolRef.current;

      if (!isDraggingRef.current || !dragStartRef.current) {
        if (tool === "select") {
          const selection = selectionBoundsRef.current;
          if (!selection) {
            const hoveredWindow = getWindowAtPoint(point);
            if (hoveredWindow) {
              hoverWindowRef.current = hoveredWindow;
              updateSelection(hoveredWindow);
              cursorManager.setCursor("crosshair");
            } else {
              clearHoverWindowPreview();
              cursorManager.setCursor("crosshair");
            }
            return;
          }

          const handle = getResizeHandleAtPoint(point, selection);
          if (handle) cursorManager.setCursor(getHandleCursor(handle));
          else if (pointInBounds(point, selection))
            cursorManager.setCursor("move");
          else cursorManager.setCursor("crosshair");
        }
        return;
      }

      if (tool === "select") {
        const dragState = selectionDragRef.current;
        if (!dragState) return;

        if (dragState.mode === "new") {
          updateSelection(normalizeBounds(dragState.start, point));
          return;
        }

        if (dragState.mode === "window") {
          const distance = Math.hypot(
            point.x - dragState.start.x,
            point.y - dragState.start.y
          );

          if (distance <= WINDOW_CLICK_DRAG_THRESHOLD) {
            updateSelection(dragState.bounds);
            return;
          }

          selectionDragRef.current = { mode: "new", start: dragState.start };
          hoverWindowRef.current = null;
          setSelectionReady(false);
          setToolbarPosition(null);
          setSelectionHandlesVisible(false);
          selectionBoundsRef.current = null;
          updateSelection(normalizeBounds(dragState.start, point));
          cursorManager.setCursor("crosshair");
          return;
        }

        if (dragState.mode === "move") {
          const nextBounds = clampMoveBounds(
            {
              ...dragState.initial,
              left: dragState.initial.left + point.x - dragState.start.x,
              top: dragState.initial.top + point.y - dragState.start.y,
            },
            canvas,
            getSelectionLimitBounds(canvas)
          );
          updateSelection(nextBounds, {
            commit: true,
            showHandles: true,
            refreshClipPaths: true,
          });
          return;
        }

        const nextBounds = computeResizeBounds(
          dragState.handle,
          dragState.initial,
          dragState.start,
          point,
          canvas,
          getSelectionLimitBounds(canvas)
        );
        updateSelection(nextBounds, {
          commit: true,
          showHandles: true,
          refreshClipPaths: true,
        });
        return;
      }

      if (!selectionBoundsRef.current) return;

      if (tool === "eraser") {
        eraseAt(point);
      } else {
        renderDraftObject(tool, dragStartRef.current, point);
      }
    };

    const handleMouseUp = (opt: fabric.TPointerEventInfo) => {
      if (longCaptureActiveRef.current) return;
      if (!isDraggingRef.current || activeToolRef.current === "pen") return;

      const pointer = canvas.getPointer(opt.e);
      const point = clampPointToCanvas({ x: pointer.x, y: pointer.y }, canvas);
      const start = dragStartRef.current;
      const tool = activeToolRef.current;
      isDraggingRef.current = false;
      dragStartRef.current = null;

      if (!start) return;

      if (tool === "select") {
        const dragState = selectionDragRef.current;
        selectionDragRef.current = null;

        if (!dragState) return;

        if (dragState.mode === "new") {
          finishSelection(normalizeBounds(dragState.start, point));
          return;
        }

        if (dragState.mode === "window") {
          finishSelection(dragState.bounds);
          hoverWindowRef.current = null;
          cursorManager.setCursor("default");
          return;
        }

        clearOcrResult();
        cursorManager.setCursor("default");
        return;
      }

      if (!selectionBoundsRef.current) return;

      if (tool === "eraser") {
        const removedObjects = [...removedDuringStrokeRef.current];
        removedDuringStrokeRef.current = new Set();
        pushHistory({ type: "remove", objects: removedObjects });
      } else {
        void finishDraftObject(tool, start, point);
      }
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);

    return () => {
      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<CaptureStartPayload>(
      "start-capture",
      async (event) => {
        const uiStartedAt = performance.now();
        let trace: CaptureTimingTrace | null = null;
        let currentStage = "event_received";
        try {
          const currentWindow = getCurrentWindow();
          currentWindowLabelRef.current = currentWindow.label;
          if (
            event.payload?.label &&
            event.payload.label !== currentWindowLabelRef.current
          ) {
            return;
          }
          trace = {
            captureId: event.payload.captureId,
            source: event.payload.source,
            triggeredAtMs: event.payload.triggeredAtMs,
            uiStartedAt,
            lastMark: uiStartedAt,
            monitorLabel: currentWindowLabelRef.current,
          };
          logCaptureTiming(trace, "event_received");

          currentStage = "unregister_long_capture_shortcuts";
          await unregisterLongCaptureShortcuts();
          logCaptureTiming(trace, currentStage);

          currentStage = "stop_long_capture_native_mode";
          await stopLongCaptureNativeMode();
          logCaptureTiming(trace, currentStage);

          currentStage = "window_hide";
          await currentWindow.hide();
          logCaptureTiming(trace, currentStage);

          currentStage = "editor_reset";
          resetEditor();
          currentCaptureMonitorRef.current = event.payload ?? null;
          logCaptureTiming(trace, currentStage);

          const captureWindowsPromise = invoke<RawCaptureWindowRegion[]>(
            "list_capture_windows",
            {
              windowLabel: currentWindowLabelRef.current,
              captureId: trace.captureId,
              source: trace.source,
            }
          ).catch((error) => {
            console.warn("Failed to list capture windows:", error);
            return [];
          });

          currentStage = "capture_fullscreen_ipc";
          const imageBytes = await invoke<ArrayBuffer>("capture_fullscreen", {
            windowLabel: currentWindowLabelRef.current,
            captureId: trace.captureId,
            source: trace.source,
          });
          logCaptureTiming(
            trace,
            currentStage,
            `bytes=${imageBytes.byteLength}`
          );

          currentStage = "source_image_decode";
          const blob = new Blob([imageBytes], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          sourceUrlRef.current = url;

          const sourceImage = new Image();
          sourceImage.src = url;
          await sourceImage.decode();
          sourceImageRef.current = sourceImage;
          logCaptureTiming(
            trace,
            currentStage,
            `${sourceImage.naturalWidth}x${sourceImage.naturalHeight}`
          );

          const canvas = fabricCanvasRef.current;
          if (!canvas) {
            throw new Error("Fabric canvas is not initialized");
          }

          currentStage = "fabric_background_from_url";
          const img = await fabric.FabricImage.fromURL(url);
          logCaptureTiming(trace, currentStage);

          const scale = canvas.getWidth() / img.width;
          scaleRef.current = scale;

          currentStage = "background_and_mask_add";
          img.set({
            left: 0,
            top: 0,
            scaleX: scale,
            scaleY: scale,
            selectable: false,
            evented: false,
          });
          bgImgRef.current = img;
          canvas.add(img);

          const mask = new fabric.Rect({
            left: 0,
            top: 0,
            width: canvas.getWidth(),
            height: canvas.getHeight(),
            fill: "rgba(0, 0, 0, 0.52)",
            selectable: false,
            evented: false,
          });
          maskRef.current = mask;
          canvas.add(mask);
          logCaptureTiming(trace, currentStage);

          currentStage = "fabric_selection_from_url";
          const selectionImg = await fabric.FabricImage.fromURL(url);
          logCaptureTiming(trace, currentStage);
          selectionImg.set({
            left: 0,
            top: 0,
            scaleX: scale,
            scaleY: scale,
            selectable: false,
            evented: false,
            visible: false,
          });
          selectionImgRef.current = selectionImg;
          canvas.add(selectionImg);

          currentStage = "canvas_render_request";
          cursorManager.setTool(ToolType.Selection);
          canvas.requestRenderAll();
          logCaptureTiming(trace, currentStage);

          currentStage = "window_show";
          await currentWindow.show();
          logCaptureTiming(trace, currentStage);

          currentStage = "window_focus";
          await currentWindow.setFocus();
          logCaptureTiming(trace, currentStage);

          currentStage = "ready_for_selection";
          await waitForNextPaint();
          logCaptureTiming(trace, currentStage);
          recordCaptureUiResult(trace, "ready", currentStage);

          const readyTrace = trace;
          void captureWindowsPromise.then((captureWindows) => {
            windowRegionsRef.current = mapCaptureWindowsToCanvas(
              captureWindows,
              canvas
            );
            logCaptureTiming(
              readyTrace,
              "window_regions_ready",
              `regions=${captureWindows.length}`
            );
          });
        } catch (error) {
          if (trace) {
            logCaptureTiming(trace, "failed", `failed_stage=${currentStage}`);
            recordCaptureUiResult(trace, "failed", currentStage, error);
          }
          console.error("Failed to start capture:", error);
        }
      }
    );

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<CaptureHoverPointPayload>(
      "capture-hover-point",
      (event) => {
        const payload = event.payload;
        if (!payload || payload.label !== currentWindowLabelRef.current) {
          return;
        }

        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        previewHoverWindowAtPoint({
          x:
            payload.x *
            (canvas.getWidth() / Math.max(1, payload.monitorWidth)),
          y:
            payload.y *
            (canvas.getHeight() / Math.max(1, payload.monitorHeight)),
        });
      }
    );

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("capture-hover-clear", () => {
      clearHoverWindowPreview();
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if (
        isImeComposingEvent(event) ||
        isKeyboardInputTarget(event.target) ||
        isScreenshotTextEditing()
      ) {
        return;
      }

      if (longCaptureActiveRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          await closeCapture();
        } else if (event.key === "Enter") {
          event.preventDefault();
          await finishLongCapture();
        }
        return;
      }

      if (event.key === "Escape") {
        await closeCapture();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        if (deleteSelectedAnnotation()) event.preventDefault();
      } else if (event.key === "Enter") {
        await copyToClipboard();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!selectionReady || !selectionBoundsRef.current) return;
    syncToolbarPosition(selectionBoundsRef.current);
  }, [
    activeTool,
    historyRevision,
    markerColor,
    selectedAnnotationRevision,
    selectionReady,
    strokeColor,
    strokeWidth,
    textSize,
  ]);

  const toolbar = useMemo(() => {
    if (!selectionReady || isLongCaptureActive) return null;

    const selectedAnnotation = selectedAnnotationRef.current;
    const selectedTool = getAnnotationData(selectedAnnotation)?.tool;
    const optionTool = selectedTool ?? activeTool;
    const showStrokeOptions = isStrokeTool(optionTool);
    const showTextOptions = isTextTool(optionTool);
    const showMarkerOptions = optionTool === "sequence";
    const popoverPlacement =
      toolbarPosition && toolbarPosition.top < 96 ? "below" : "above";
    const renderToolOptions = () => (
      <div className={`tool-popover ${popoverPlacement}`}>
        <label
          className="color-button"
          title={t(
            showMarkerOptions
              ? "screenshot.tools.numberColor"
              : "screenshot.tools.strokeColor"
          )}
        >
          <Palette size={17} />
          <span
            className="color-preview"
            style={{
              background: showMarkerOptions ? markerColor : strokeColor,
            }}
          />
          <input
            type="color"
            value={showMarkerOptions ? markerColor : strokeColor}
            onChange={(event) =>
              showMarkerOptions
                ? applyMarkerColor(event.target.value)
                : applyStrokeColor(event.target.value)
            }
          />
        </label>

        {showStrokeOptions &&
          STROKE_WIDTH_OPTIONS.map((width) => (
            <button
              className={`stroke-width-button${
                strokeWidth === width ? " active" : ""
              }`}
              key={width}
              type="button"
              title={t("screenshot.tools.strokeWidth")}
              onClick={() => applyStrokeWidth(width)}
            >
              <span
                className="stroke-width-line"
                style={{ height: `${width}px` }}
              />
            </button>
          ))}

        {showTextOptions &&
          TEXT_SIZE_OPTIONS.map((size) => (
            <button
              className={`text-size-button${textSize === size ? " active" : ""}`}
              key={size}
              type="button"
              title={t("screenshot.tools.textSize")}
              onClick={() => applyTextSize(size)}
            >
              {size}
            </button>
          ))}
      </div>
    );

    return (
      <div
        ref={toolbarRef}
        className="capture-toolbar"
        style={
          toolbarPosition
            ? {
                left: toolbarPosition.left,
                top: toolbarPosition.top,
              }
            : undefined
        }
      >
        {!isLongCaptureResultReady && (
          <div className="toolbar-group">
            {TOOL_BUTTONS.map(({ tool, titleKey, icon: Icon }) => (
              <div className="tool-button-wrap" key={tool}>
                <button
                  className={`tool-button${
                    activeTool === tool || selectedTool === tool
                      ? " active"
                      : ""
                  }`}
                  type="button"
                  title={t(titleKey)}
                  onClick={() => {
                    if (tool !== "select") selectAnnotation(null);
                    setActiveTool(tool);
                  }}
                >
                  <Icon size={18} />
                </button>
                {optionTool === tool &&
                  (showStrokeOptions || showMarkerOptions || showTextOptions) &&
                  renderToolOptions()}
              </div>
            ))}
          </div>
        )}

        <div className="toolbar-group">
          <button
            className="tool-button danger"
            type="button"
            title={t("screenshot.tools.close")}
            onClick={() => void closeCapture()}
          >
            <X size={18} />
          </button>
          <button
            className="tool-button"
            type="button"
            title={t("screenshot.tools.undo")}
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="tool-button"
            type="button"
            title={t("screenshot.tools.redo")}
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 size={18} />
          </button>
        </div>

        <div className="toolbar-group">
          {!isLongCaptureResultReady && (
            <button
              className="tool-button"
              type="button"
              title={t("screenshot.tools.longCapture")}
              onClick={() => void startLongCapture()}
            >
              <LongCaptureIcon size={18} />
            </button>
          )}
          <button
            className="tool-button"
            type="button"
            title={t("screenshot.tools.ocr")}
            disabled={ocrPanel.status === "recognizing"}
            onClick={() => void runOcrOnSelection(true)}
          >
            {ocrPanel.status === "recognizing" ? (
              <Loader2 className="spin-icon" size={18} />
            ) : (
              <FileText size={18} />
            )}
          </button>
          <button
            className="tool-button"
            type="button"
            title={t("screenshot.tools.translateOverlay")}
            disabled={translationOverlayBusy}
            onClick={() => void addTranslatedOverlay()}
          >
            {translationOverlayBusy ? (
              <Loader2 className="spin-icon" size={18} />
            ) : (
              <Languages size={18} />
            )}
          </button>
          <button
            className="tool-button"
            type="button"
            title={t("screenshot.tools.download")}
            onClick={() => void downloadCapture()}
          >
            <Download size={18} />
          </button>
          <button
            className="tool-button"
            type="button"
            title={t("screenshot.tools.pin")}
            onClick={() => void pinCapture()}
          >
            <Pin size={18} />
          </button>
          <button
            className="tool-button primary"
            type="button"
            title={t("screenshot.tools.copy")}
            onClick={() => void copyToClipboard()}
          >
            <Check size={18} />
          </button>
        </div>
      </div>
    );
  }, [
    activeTool,
    canRedo,
    canUndo,
    isLongCaptureActive,
    isLongCaptureResultReady,
    markerColor,
    ocrPanel.status,
    ocrPanel.targetLang,
    selectionReady,
    selectedAnnotationRevision,
    strokeColor,
    strokeWidth,
    t,
    textSize,
    toolbarPosition,
    translationOverlayBusy,
  ]);

  const longCapturePanelStyle = useMemo<CSSProperties | undefined>(() => {
    const bounds = longCaptureBoundsRef.current;
    if (!isLongCaptureActive || !bounds) return undefined;

    const panelBounds = getLongCapturePanelBounds(bounds);
    return { left: panelBounds.left, top: panelBounds.top };
  }, [isLongCaptureActive, longCapture.frameCount]);

  const ocrPanelStyle = useMemo<CSSProperties | undefined>(() => {
    const bounds = selectionBoundsRef.current;
    if (ocrPanel.status === "idle" || !bounds) return undefined;

    const panelBounds = getOcrPanelBounds(bounds);
    return { left: panelBounds.left, top: panelBounds.top };
  }, [ocrPanel.status, selectionReady, selectedAnnotationRevision]);

  const isOcrBusy =
    ocrPanel.status === "recognizing" || ocrPanel.status === "translating";
  const ocrPanelView =
    ocrPanel.status !== "idle" ? (
      <div className="ocr-panel" style={ocrPanelStyle}>
        <div className="ocr-panel-header">
          <div className="ocr-panel-title">
            {isOcrBusy ? (
              <Loader2 className="spin-icon" size={17} />
            ) : (
              <FileText size={17} />
            )}
            <span>{t("screenshot.ocr.title")}</span>
          </div>
          <button
            className="ocr-icon-button"
            type="button"
            title={t("screenshot.ocr.close")}
            onClick={clearOcrResult}
          >
            <X size={16} />
          </button>
        </div>

        <div className="ocr-panel-actions">
          <select
            className="ocr-language-select"
            value={ocrPanel.targetLang}
            onChange={(event) => setOcrTargetLang(event.target.value)}
            title={t("screenshot.ocr.targetLanguage")}
          >
            {TRANSLATION_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </select>
          <button
            className="ocr-action-button"
            type="button"
            disabled={!ocrPanel.result || isOcrBusy}
            onClick={() => void translateOcrPanelText()}
          >
            <Languages size={15} />
            <span>
              {ocrPanel.showingTranslation
                ? t("screenshot.ocr.showOriginal")
                : t("screenshot.ocr.translate")}
            </span>
          </button>
          <button
            className="ocr-action-button"
            type="button"
            disabled={!ocrPanel.displayText.trim()}
            onClick={() => void copyOcrText()}
          >
            <Copy size={15} />
            <span>{t("screenshot.ocr.copy")}</span>
          </button>
        </div>

        <textarea
          className="ocr-textarea"
          value={ocrPanel.displayText}
          placeholder={
            ocrPanel.status === "recognizing"
              ? t("screenshot.ocr.recognizing")
              : t("screenshot.ocr.empty")
          }
          onChange={(event) =>
            setOcrPanel((current) => ({
              ...current,
              displayText: event.target.value,
            }))
          }
        />

        {ocrPanel.result && ocrPanel.result.qrCodes.length > 0 && (
          <div className="ocr-qr-list">
            <div className="ocr-qr-title">{t("screenshot.ocr.qrCodes")}</div>
            {ocrPanel.result.qrCodes.map((qrCode) => (
              <button
                className="ocr-qr-item"
                key={qrCode.value}
                type="button"
                title={qrCode.value}
                onClick={() =>
                  void invoke("copy_text_to_clipboard", {
                    text: qrCode.value,
                  })
                }
              >
                {qrCode.value}
              </button>
            ))}
          </div>
        )}

        {ocrPanel.error && <div className="ocr-panel-error">{ocrPanel.error}</div>}
      </div>
    ) : null;

  const longCapturePanel = isLongCaptureActive ? (
    <div
      ref={longCapturePanelRef}
      className="long-capture-panel"
      style={longCapturePanelStyle}
    >
      <div className="long-capture-preview">
        <canvas
          ref={longCapturePreviewCanvasRef}
          width={LONG_CAPTURE_PREVIEW_WIDTH}
          height={LONG_CAPTURE_PREVIEW_HEIGHT}
          aria-label={t("screenshot.longCapture.preview")}
        />
      </div>
      <div className="long-capture-content">
        <div className="long-capture-title">
          <LongCaptureIcon size={18} />
          <span>{t("screenshot.longCapture.title")}</span>
        </div>
        <div className="long-capture-meta">
          {t("screenshot.longCapture.meta", {
            count: longCapture.frameCount,
            height: longCapture.height,
          })}
        </div>
        <div className="long-capture-message">
          {longCapture.messageKey ? t(longCapture.messageKey) : null}
        </div>
        <div className="long-capture-shortcuts">
          <span>
            <kbd>Enter</kbd>
            {t("screenshot.longCapture.finish")}
          </span>
          <span>
            <kbd>Esc</kbd>
            {t("screenshot.longCapture.cancel")}
          </span>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="screenshot-root">
      <canvas ref={canvasElementRef} className="screenshot-canvas" />
      {longCapturePanel}
      {ocrPanelView}
      {toolbar}
    </div>
  );
}
