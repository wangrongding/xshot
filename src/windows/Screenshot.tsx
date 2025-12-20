import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function ScreenshotWindow() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // 4. 事件响应：监听开始截图信号
  useEffect(() => {
    const unlisten = listen("start-capture", async () => {
      console.log("Received start-capture event");
      // 重置状态，防止上次的选区残留
      setRect(null);
      setStartPos(null);
      
      try {
        // 确保窗口是隐藏的，防止截到自己
        await getCurrentWindow().hide();

        // 调用 Rust 获取截图
        const imageBytes = await invoke<ArrayBuffer>("capture_fullscreen");
        console.log("Screenshot captured successfully");
        const blob = new Blob([imageBytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        setImageSrc((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (error) {
        console.error("Failed to capture screenshot:", error);
      }
    });

    return () => { unlisten.then(f => f()); };
  }, []);

  // 完成截图（双击或回车）
  const handleFinishCapture = async () => {
    if (!rect || rect.w <= 0 || rect.h <= 0 || !canvasRef.current) return;

    console.log("Capture finished, rect:", rect);
    
    try {
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;

      // 获取选区内的像素数据
      const imageData = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      // 转换为普通数组以便传递给 Rust
      const pixels = Array.from(imageData.data);

      await invoke("copy_to_clipboard", {
        buffer: pixels,
        width: Math.round(rect.w),
        height: Math.round(rect.h),
      });
      console.log("Region copied to clipboard");
    } catch (error) {
      console.error("Failed to copy region to clipboard:", error);
    }

    // 6. 窗口释放与再生
    await invoke("finish_capture");
    
    // 重置状态
    setImageSrc(null);
    setRect(null);
    setStartPos(null);
  };

  // 监听键盘事件：Esc 取消截图, Enter 完成截图
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        console.log("Escape pressed, cancelling capture");
        const win = getCurrentWindow();
        await win.hide();
        // 重置状态
        setImageSrc(null);
        setRect(null);
        setStartPos(null);
      } else if (e.key === "Enter") {
        await handleFinishCapture();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [rect]); // 依赖 rect，确保能获取到最新的选区

  // 绘制逻辑：图片 + 遮罩 + 选区
  useEffect(() => {
    if (!canvasRef.current || !imageSrc) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = async () => {
      // 1. 绘制全屏截图
      ctx.canvas.width = window.innerWidth;
      ctx.canvas.height = window.innerHeight;
      ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);

      // 2. 绘制半透明遮罩 (全屏)
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      // 3. 挖空选区 (Destination-Out) 或 重绘选区部分图片
      if (rect) {
        // 简单做法：重绘选区部分的图片，使其"亮"起来
        // 保存上下文
        ctx.save();
        // 设置裁剪区域为选区
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        // 在裁剪区域内重绘原图（没有遮罩）
        ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
        
        // 绘制选区边框
        ctx.strokeStyle = "#1677ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        
        ctx.restore();
      }

      // 图片绘制完成，显示窗口
      console.log("Image loaded and drawn, showing window...");
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
    };
    img.src = imageSrc;
  }, [imageSrc, rect]);

  // 鼠标交互逻辑
  const handleMouseDown = (e: React.MouseEvent) => {
    setStartPos({ x: e.clientX, y: e.clientY });
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!startPos) return;
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    // 计算标准化矩形（处理反向拖拽）
    const x = Math.min(startPos.x, currentX);
    const y = Math.min(startPos.y, currentY);
    const w = Math.abs(currentX - startPos.x);
    const h = Math.abs(currentY - startPos.y);
    
    setRect({ x, y, w, h });
  };

  const handleMouseUp = () => {
    setStartPos(null);
    // 选区确定
  };

  if (!imageSrc) return <div className="text-white">Initializing...</div>;

  return (
    <canvas
      ref={canvasRef}
      style={{ cursor: "crosshair", display: "block" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleFinishCapture}
    />
  );
}
