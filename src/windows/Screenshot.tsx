import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import {
  Check,
  Download,
  Eraser,
  Grid3X3,
  Palette,
  PenLine,
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
  title: string;
  appName: string;
  isFullscreenLike: boolean;
  isOverlayCandidate: boolean;
  isFocused: boolean;
};
type RawCaptureWindowRegion = {
  id: number;
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
type AnnotationData = {
  role: "annotation";
  tool: AnnotationTool;
  color?: string;
  strokeWidth?: number;
  fontSize?: number;
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
const TOOLBAR_MARGIN = 10;
const DEFAULT_TOOLBAR_WIDTH = 560;
const DEFAULT_TOOLBAR_HEIGHT = 54;
const WINDOW_CLICK_DRAG_THRESHOLD = 5;
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

function logCaptureTiming(start: number, label: string) {
  if (!import.meta.env.DEV) return;
  console.debug(
    `[xshot] capture ${label}: ${Math.round(performance.now() - start)}ms`
  );
}

function normalizeBounds(start: Point, end: Point): Bounds {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
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

function clampMoveBounds(bounds: Bounds, canvas: fabric.Canvas): Bounds {
  const maxLeft = Math.max(0, canvas.getWidth() - bounds.width);
  const maxTop = Math.max(0, canvas.getHeight() - bounds.height);

  return {
    ...bounds,
    left: Math.min(Math.max(0, bounds.left), maxLeft),
    top: Math.min(Math.max(0, bounds.top), maxTop),
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
  canvas: fabric.Canvas
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

  left = Math.min(Math.max(0, left), canvas.getWidth());
  right = Math.min(Math.max(0, right), canvas.getWidth());
  top = Math.min(Math.max(0, top), canvas.getHeight());
  bottom = Math.min(Math.max(0, bottom), canvas.getHeight());

  if (right - left < MIN_SELECTION_SIZE) {
    if (handle.includes("w")) left = right - MIN_SELECTION_SIZE;
    else right = left + MIN_SELECTION_SIZE;
  }

  if (bottom - top < MIN_SELECTION_SIZE) {
    if (handle.includes("n")) top = bottom - MIN_SELECTION_SIZE;
    else bottom = top + MIN_SELECTION_SIZE;
  }

  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (right > canvas.getWidth()) right = canvas.getWidth();
  if (bottom > canvas.getHeight()) bottom = canvas.getHeight();

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
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const bgImgRef = useRef<fabric.FabricImage | null>(null);
  const selectionImgRef = useRef<fabric.FabricImage | null>(null);
  const maskRef = useRef<fabric.Rect | null>(null);
  const selectionBoundsRef = useRef<Bounds | null>(null);
  const scaleRef = useRef(1);
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
  const [toolbarPosition, setToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const canUndo = historyRevision >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyRevision >= 0 && redoStackRef.current.length > 0;

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
      Math.max(TOOLBAR_MARGIN, top),
      Math.max(
        TOOLBAR_MARGIN,
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
      fabricCanvasRef.current?.requestRenderAll();
    }
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

  const resetEditor = () => {
    const canvas = fabricCanvasRef.current;
    canvas?.clear();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);

    sourceUrlRef.current = null;
    sourceImageRef.current = null;
    bgImgRef.current = null;
    selectionImgRef.current = null;
    maskRef.current = null;
    selectionBoundsRef.current = null;
    dragStartRef.current = null;
    selectionDragRef.current = null;
    windowRegionsRef.current = [];
    hoverWindowRef.current = null;
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
    if (!canvas || !selectionImg || !bgImgRef.current) return;

    const scale = scaleRef.current;
    selectionImg.set({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width / scale,
      height: bounds.height / scale,
      cropX: bounds.left / scale,
      cropY: bounds.top / scale,
      visible: true,
    });

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
      setSelectionHandlesVisible(false);
      setToolbarPosition(null);
      setSelectionReady(false);
      fabricCanvasRef.current?.requestRenderAll();
      return;
    }

    const canvas = fabricCanvasRef.current;
    const nextBounds = canvas ? clampMoveBounds(bounds, canvas) : bounds;
    selectionBoundsRef.current = nextBounds;
    updateSelection(nextBounds, {
      commit: true,
      showHandles: true,
      refreshClipPaths: true,
    });
    setSelectionReady(true);
    setActiveTool("select");
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

  const exportSelectionBlob = async () => {
    const canvas = fabricCanvasRef.current;
    const selectionImg = selectionImgRef.current;
    const bounds = selectionBoundsRef.current;
    if (!canvas || !selectionImg || !bounds) return null;

    const originalStrokeWidth = selectionImg.strokeWidth;
    try {
      selectionImg.set("strokeWidth", 0);
      setSelectionHandlesVisible(false);
      canvas.discardActiveObject();
      canvas.requestRenderAll();

      return await canvas.toBlob({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        format: "png",
        multiplier: 1,
      });
    } finally {
      selectionImg.set("strokeWidth", originalStrokeWidth);
      setSelectionHandlesVisible(true);
      syncSelectionHandles(bounds);
      canvas.requestRenderAll();
    }
  };

  const closeCapture = async () => {
    await invoke("finish_capture");
    resetEditor();
  };

  const copyToClipboard = async () => {
    const blob = await exportSelectionBlob();
    if (!blob) return;

    const arrayBuffer = await blob.arrayBuffer();
    await invoke("copy_to_clipboard", {
      blobData: new Uint8Array(arrayBuffer),
    });
    await closeCapture();
  };

  const downloadCapture = async () => {
    const blob = await exportSelectionBlob();
    if (!blob) return;

    const arrayBuffer = await blob.arrayBuffer();
    const settings = getSettings();
    await invoke("save_to_downloads", {
      blobData: new Uint8Array(arrayBuffer),
      directory: settings.defaultSaveDirectory || null,
    });
    await closeCapture();
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
            canvas
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
          canvas
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
    const unlisten = listen("start-capture", async () => {
      const startedAt = performance.now();
      try {
        await getCurrentWindow().hide();
        resetEditor();
        logCaptureTiming(startedAt, "window hidden");

        const imageBytes = await invoke<ArrayBuffer>("capture_fullscreen");
        logCaptureTiming(startedAt, "screen captured");
        const blob = new Blob([imageBytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        sourceUrlRef.current = url;

        const sourceImage = new Image();
        sourceImage.src = url;
        await sourceImage.decode();
        sourceImageRef.current = sourceImage;
        logCaptureTiming(startedAt, "source image decoded");

        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        const img = await fabric.FabricImage.fromURL(url);
        const scale = canvas.getWidth() / img.width;
        scaleRef.current = scale;
        const captureWindows = await invoke<RawCaptureWindowRegion[]>(
          "list_capture_windows"
        ).catch((error) => {
          console.warn("Failed to list capture windows:", error);
          return [];
        });
        windowRegionsRef.current = mapCaptureWindowsToCanvas(
          captureWindows,
          canvas
        );

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

        const selectionImg = await fabric.FabricImage.fromURL(url);
        logCaptureTiming(startedAt, "fabric images and windows ready");
        selectionImg.set({
          left: 0,
          top: 0,
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
          visible: false,
          stroke: "#1677ff",
          strokeWidth: 2 / scale,
        });
        selectionImgRef.current = selectionImg;
        canvas.add(selectionImg);

        cursorManager.setTool(ToolType.Selection);
        canvas.requestRenderAll();

        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
        logCaptureTiming(startedAt, "shown");
      } catch (error) {
        console.error("Failed to start capture:", error);
      }
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        await closeCapture();
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

    return selectionReady ? (
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
        <div className="toolbar-group">
          {TOOL_BUTTONS.map(({ tool, titleKey, icon: Icon }) => (
            <div className="tool-button-wrap" key={tool}>
              <button
                className={`tool-button${
                  activeTool === tool || selectedTool === tool ? " active" : ""
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
          <button
            className="tool-button"
            type="button"
            title={t("screenshot.tools.download")}
            onClick={() => void downloadCapture()}
          >
            <Download size={18} />
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
    ) : null;
  }, [
    activeTool,
    canRedo,
    canUndo,
    markerColor,
    selectionReady,
    selectedAnnotationRevision,
    strokeColor,
    strokeWidth,
    t,
    toolbarPosition,
  ]);

  return (
    <div className="screenshot-root">
      <canvas ref={canvasElementRef} className="screenshot-canvas" />
      {toolbar}
    </div>
  );
}
