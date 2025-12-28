import * as fabric from "fabric";

/**
 * 光标类型枚举
 * 定义应用中所有可用的光标样式
 *
 * 使用方式：cursorManager.setCursor(CursorType.Crosshair)
 * 扩展方式：添加新的枚举值，可以是 CSS 光标名或自定义光标
 */
export enum CursorType {
  // ========== 基础光标 ==========
  /** 默认箭头光标 - 用于普通状态、选中对象后 */
  Default = "default",
  /** 十字准星光标 - 用于绘制、框选等精确操作 */
  Crosshair = "crosshair",
  /** 手指光标 - 用于可点击元素、链接 */
  Pointer = "pointer",
  /** 移动光标 - 用于拖拽移动对象 */
  Move = "move",
  /** 文本光标 - 用于文本输入区域 */
  Text = "text",
  /** 等待光标 - 用于加载、处理中状态 */
  Wait = "wait",
  /** 禁止光标 - 用于不可操作区域 */
  NotAllowed = "not-allowed",

  // ========== 调整大小光标 ==========
  /** 上边缘调整 */
  ResizeN = "n-resize",
  /** 下边缘调整 */
  ResizeS = "s-resize",
  /** 右边缘调整 */
  ResizeE = "e-resize",
  /** 左边缘调整 */
  ResizeW = "w-resize",
  /** 右上角调整 */
  ResizeNE = "ne-resize",
  /** 左上角调整 */
  ResizeNW = "nw-resize",
  /** 右下角调整 */
  ResizeSE = "se-resize",
  /** 左下角调整 */
  ResizeSW = "sw-resize",

  // ========== 绘图工具光标 ==========
  // 目前使用 crosshair，后续可替换为自定义图片光标
  /** 画笔工具 */
  Pen = "crosshair",
  /** 笔刷工具 */
  Brush = "crosshair",
  /** 橡皮擦工具 */
  Eraser = "crosshair",
  /** 箭头标注工具 */
  Arrow = "crosshair",
  /** 矩形工具 */
  Rectangle = "crosshair",
  /** 圆形工具 */
  Circle = "crosshair",
  /** 直线工具 */
  Line = "crosshair",
}

/**
 * 工具类型枚举
 * 定义应用中所有可用的工具
 */
export enum ToolType {
  /** 选择工具 - 用于选中和操作已有对象 */
  Select = "select",
  /** 框选工具 - 用于截图时绘制选区 */
  Selection = "selection",
  /** 画笔工具 - 自由绘制线条 */
  Pen = "pen",
  /** 笔刷工具 - 绘制较粗的笔触 */
  Brush = "brush",
  /** 橡皮擦工具 - 擦除内容 */
  Eraser = "eraser",
  /** 箭头工具 - 绘制箭头标注 */
  Arrow = "arrow",
  /** 矩形工具 - 绘制矩形框 */
  Rectangle = "rectangle",
  /** 圆形工具 - 绘制圆形/椭圆 */
  Circle = "circle",
  /** 直线工具 - 绘制直线 */
  Line = "line",
  /** 文字工具 - 添加文字标注 */
  Text = "text",
  /** 移动工具 - 平移画布或对象 */
  Move = "move",
}

/**
 * 工具名称到光标类型的映射表
 *
 * 作用：根据当前选择的工具，自动设置对应的光标样式
 * 使用：cursorManager.setTool(ToolType.Pen) 会自动应用 CursorType.Pen
 *
 * 扩展方式：
 * 1. 在 ToolType 枚举中添加新的工具类型
 * 2. 在 CursorType 枚举中添加对应的光标类型（如需要）
 * 3. 在此映射表中添加 工具 -> 光标 的对应关系
 */
export const ToolCursorMap: Record<ToolType, CursorType> = {
  [ToolType.Select]: CursorType.Default,
  [ToolType.Selection]: CursorType.Crosshair,
  [ToolType.Pen]: CursorType.Pen,
  [ToolType.Brush]: CursorType.Brush,
  [ToolType.Eraser]: CursorType.Eraser,
  [ToolType.Arrow]: CursorType.Arrow,
  [ToolType.Rectangle]: CursorType.Rectangle,
  [ToolType.Circle]: CursorType.Circle,
  [ToolType.Line]: CursorType.Line,
  [ToolType.Text]: CursorType.Text,
  [ToolType.Move]: CursorType.Move,
};

/**
 * 光标管理器
 * 统一管理 Fabric Canvas 的光标样式
 */
export class CursorManager {
  /** 绑定的 Fabric Canvas 实例 */
  private canvas: fabric.Canvas | null = null;
  /** 当前光标类型 */
  private currentCursor: CursorType = CursorType.Default;
  /** 当前选中的工具 */
  private currentTool: ToolType = ToolType.Selection;

  /**
   * 绑定 Fabric Canvas
   */
  bindCanvas(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  /**
   * 解绑 Canvas
   */
  unbindCanvas() {
    this.canvas = null;
  }

  /**
   * 设置当前工具，自动更新光标
   */
  setTool(tool: ToolType) {
    this.currentTool = tool;
    const cursor = ToolCursorMap[tool] || CursorType.Default;
    this.setCursor(cursor);
  }

  /**
   * 获取当前工具
   */
  getTool(): ToolType {
    return this.currentTool;
  }

  /**
   * 直接设置光标类型
   */
  setCursor(cursor: CursorType | string) {
    if (!this.canvas) return;

    this.currentCursor = cursor as CursorType;
    this.canvas.defaultCursor = cursor;
    this.canvas.setCursor(cursor);
  }

  /**
   * 获取当前光标
   */
  getCursor(): CursorType {
    return this.currentCursor;
  }

  /**
   * 重置为当前工具的默认光标
   */
  resetToToolCursor() {
    const cursor = ToolCursorMap[this.currentTool] || CursorType.Default;
    this.setCursor(cursor);
  }

  /**
   * 临时设置光标（如 hover 状态），不改变当前工具
   */
  setTemporaryCursor(cursor: CursorType | string) {
    if (!this.canvas) return;
    this.canvas.setCursor(cursor);
  }

  /**
   * 设置自定义图片光标
   * @param url 光标图片 URL
   * @param hotspot 光标热点位置 [x, y]
   */
  setCustomCursor(url: string, hotspot: [number, number] = [0, 0]) {
    const cursorValue = `url(${url}) ${hotspot[0]} ${hotspot[1]}, auto`;
    this.setCursor(cursorValue as CursorType);
  }
}

// 导出单例实例
export const cursorManager = new CursorManager();

/**
 * React Hook: 在组件中使用光标管理器
 */
export function useCursorManager() {
  return cursorManager;
}
