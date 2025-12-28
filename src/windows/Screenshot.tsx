import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as fabric from "fabric";
import { cursorManager, ToolType } from "../logic/cursor";

// 设置截图窗口的透明背景(防止白色闪烁)
if (typeof document !== "undefined") {
  document.documentElement.style.backgroundColor = "transparent";
  document.body.style.backgroundColor = "transparent";
}

export default function ScreenshotWindow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);

  // Fabric 对象引用
  const bgImgRef = useRef<fabric.FabricImage | null>(null);
  const selectionImgRef = useRef<fabric.FabricImage | null>(null);

  // 逻辑状态
  const isDragging = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const hasSelection = useRef(false);

  // 初始化 Fabric
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      selection: false,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      enableRetinaScaling: true,
    });

    canvas.setWidth(window.innerWidth);
    canvas.setHeight(window.innerHeight);

    fabricCanvasRef.current = canvas;
    cursorManager.bindCanvas(canvas);

    const handleResize = () => {
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.setWidth(window.innerWidth);
        fabricCanvasRef.current.setHeight(window.innerHeight);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cursorManager.unbindCanvas();
      canvas.dispose();
    };
  }, []);

  // 截图完成逻辑
  const handleFinishCapture = async () => {
    if (
      !selectionImgRef.current ||
      !bgImgRef.current ||
      !fabricCanvasRef.current
    )
      return;

    const canvas = fabricCanvasRef.current;
    const selection = selectionImgRef.current;

    // 获取选区在 Canvas 上的视觉属性（逻辑像素）
    const left = selection.left;
    const top = selection.top;
    const width = selection.getScaledWidth();
    const height = selection.getScaledHeight();

    if (width <= 0 || height <= 0) return;

    try {
      // 1. 临时隐藏选区边框，避免截取进去
      const originalStrokeWidth = selection.strokeWidth;
      selection.set("strokeWidth", 0);
      canvas.requestRenderAll();

      // 2. 使用 Fabric 的导出功能，直接截取 Canvas 上的选区内容（包含标注）
      // multiplier: 1 默认会导出 Canvas 的物理分辨率（如果 enableRetinaScaling 为 true）
      // 这样既保留了清晰度，又包含了所有图层（标注、底图等）
      const blob = await canvas.toBlob({
        left,
        top,
        width,
        height,
        format: "png",
        multiplier: 1,
      });

      // 3. 恢复选区边框
      selection.set("strokeWidth", originalStrokeWidth);
      canvas.requestRenderAll();

      if (!blob) return console.error("Failed to create blob");

      // 4. Blob 转 Uint8Array
      const arrayBuffer = await blob.arrayBuffer();
      const pixels = new Uint8Array(arrayBuffer);
      await invoke("copy_to_clipboard", {
        blobData: pixels,
      });
      console.log("Region copied to clipboard");
    } catch (error) {
      console.error("Failed to copy:", error);
    }

    await invoke("finish_capture");

    // 重置
    canvas.clear();
    bgImgRef.current = null;
    selectionImgRef.current = null;
    hasSelection.current = false;
  };

  // 设置事件
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: any) => {
      isDragging.current = true;
      const pointer = canvas.getPointer(opt.e);
      startPos.current = { x: pointer.x, y: pointer.y };

      // 开始新选区时，重置状态和光标为十字准星光标
      hasSelection.current = false;
      cursorManager.setTool(ToolType.Selection);

      if (selectionImgRef.current) {
        selectionImgRef.current.visible = true;
        selectionImgRef.current.set({
          cropX: 0,
          cropY: 0,
          width: 0,
          height: 0,
          left: pointer.x,
          top: pointer.y,
        });
        canvas.requestRenderAll();
      }
    };

    const handleMouseMove = (opt: any) => {
      if (
        !isDragging.current ||
        !startPos.current ||
        !selectionImgRef.current ||
        !bgImgRef.current
      )
        return;
      const pointer = canvas.getPointer(opt.e);

      const x = Math.min(startPos.current.x, pointer.x);
      const y = Math.min(startPos.current.y, pointer.y);
      const w = Math.abs(pointer.x - startPos.current.x);
      const h = Math.abs(pointer.y - startPos.current.y);

      const scale = bgImgRef.current.scaleX || 1;

      selectionImgRef.current.set({
        left: x,
        top: y,
        width: w / scale,
        height: h / scale,
        cropX: x / scale,
        cropY: y / scale,
      });

      canvas.requestRenderAll();
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      updateCursor();
    };

    // 控制鼠标指针样式
    const updateCursor = () => {
      // 检查是否有有效选区，有则恢复正常鼠标指针
      if (selectionImgRef.current && selectionImgRef.current.visible) {
        const w = selectionImgRef.current.getScaledWidth();
        const h = selectionImgRef.current.getScaledHeight();
        if (w > 5 && h > 5) {
          hasSelection.current = true;
          cursorManager.setTool(ToolType.Select);
        }
      }
    };

    const handleDoubleClick = () => {
      handleFinishCapture();
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);
    canvas.on("mouse:dblclick", handleDoubleClick);

    return () => {
      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
      canvas.off("mouse:dblclick", handleDoubleClick);
    };
  }, []);

  // 监听开始截图事件
  useEffect(() => {
    const unlisten = listen("start-capture", async () => {
      console.log("Received start-capture event");

      try {
        await getCurrentWindow().hide();
        const imageBytes = await invoke<ArrayBuffer>("capture_fullscreen");
        const blob = new Blob([imageBytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);

        if (fabricCanvasRef.current) {
          const canvas = fabricCanvasRef.current;
          canvas.clear();

          // 加载图片
          const img = await fabric.FabricImage.fromURL(url);

          // 计算缩放比例以适应窗口
          const scale = canvas.getWidth() / img.width;

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

          // 添加遮罩
          const mask = new fabric.Rect({
            left: 0,
            top: 0,
            width: canvas.getWidth(),
            height: canvas.getHeight(),
            fill: "rgba(0, 0, 0, 0.5)",
            selectable: false,
            evented: false,
          });
          canvas.add(mask);

          // 添加选区图片（克隆）
          const selectionImg = await fabric.FabricImage.fromURL(url);
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

          // 初始化光标为选区工具
          cursorManager.setTool(ToolType.Selection);
          hasSelection.current = false;

          canvas.requestRenderAll();

          const win = getCurrentWindow();
          await win.show();
          await win.setFocus();
        }
      } catch (e) {
        console.error(e);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const win = getCurrentWindow();
        await win.hide();
        if (fabricCanvasRef.current) fabricCanvasRef.current.clear();
      } else if (e.key === "Enter") {
        await handleFinishCapture();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}
