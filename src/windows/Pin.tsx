import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { Copy, Download, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getSettings } from "../logic/settings";

type PinWindowPayload = {
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  initialWidth: number;
  initialHeight: number;
};

type ContextMenuState = {
  left: number;
  top: number;
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.0018;
const KEYBOARD_ZOOM_FACTOR = 1.12;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function imageUrlToBytes(imageUrl: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to read pinned image: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export default function PinWindow() {
  const { t } = useTranslation();
  const win = useMemo(() => getCurrentWindow(), []);
  const [payload, setPayload] = useState<PinWindowPayload | null>(null);
  const [zoom, setZoom] = useState(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const zoomRef = useRef(1);
  const isClosingRef = useRef(false);
  const imageUrl = useMemo(
    () => (payload ? convertFileSrc(payload.imagePath) : ""),
    [payload]
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const previousHtmlBackground =
      document.documentElement.style.backgroundColor;
    const previousBodyBackground = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";

    void invoke<PinWindowPayload>("get_pin_window_payload", {
      label: win.label,
    })
      .then((nextPayload) => {
        setPayload(nextPayload);
        void win.setSize(
          new LogicalSize(nextPayload.initialWidth, nextPayload.initialHeight)
        );
      })
      .catch((error) => {
        console.error("Failed to load pinned image:", error);
        void win.close();
      });

    return () => {
      document.documentElement.style.backgroundColor = previousHtmlBackground;
      document.body.style.backgroundColor = previousBodyBackground;
    };
  }, [win]);

  const closeWindow = useCallback(async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    await invoke("close_pin_window", { label: win.label }).catch((error) => {
      console.warn("Failed to close pinned window through backend:", error);
      return win.close();
    });
  }, [win]);

  const copyImage = useCallback(async () => {
    if (!imageUrl) return;

    const blobData = await imageUrlToBytes(imageUrl);
    await invoke("copy_to_clipboard", { blobData });
    setContextMenu(null);
  }, [imageUrl]);

  const saveImage = useCallback(async () => {
    if (!imageUrl) return;

    const blobData = await imageUrlToBytes(imageUrl);
    const settings = getSettings();
    await invoke("save_to_downloads", {
      blobData,
      directory: settings.defaultSaveDirectory || null,
    });
    setContextMenu(null);
  }, [imageUrl]);

  const resetZoom = useCallback(async () => {
    if (!payload) return;

    const scaleFactor = await win.scaleFactor();
    const size = await win.innerSize();
    const position = await win.outerPosition();
    const logicalSize = size.toLogical(scaleFactor);
    const logicalPosition = position.toLogical(scaleFactor);
    const centerX = logicalPosition.x + logicalSize.width / 2;
    const centerY = logicalPosition.y + logicalSize.height / 2;
    const nextWidth = payload.initialWidth;
    const nextHeight = payload.initialHeight;

    await win.setSize(new LogicalSize(nextWidth, nextHeight));
    await win.setPosition(
      new LogicalPosition(centerX - nextWidth / 2, centerY - nextHeight / 2)
    );
    setZoom(1);
  }, [payload, win]);

  const zoomAroundPoint = useCallback(
    async (factor: number, pointX: number, pointY: number) => {
      if (!payload) return;

      const currentZoom = zoomRef.current;
      const nextZoom = clamp(currentZoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(nextZoom - currentZoom) < 0.001) return;

      const scaleFactor = await win.scaleFactor();
      const size = await win.innerSize();
      const position = await win.outerPosition();
      const logicalSize = size.toLogical(scaleFactor);
      const logicalPosition = position.toLogical(scaleFactor);
      const nextWidth = Math.max(
        32,
        Math.round(payload.initialWidth * nextZoom)
      );
      const nextHeight = Math.max(
        32,
        Math.round(payload.initialHeight * nextZoom)
      );
      const fractionX =
        logicalSize.width > 0 ? pointX / logicalSize.width : 0.5;
      const fractionY =
        logicalSize.height > 0 ? pointY / logicalSize.height : 0.5;
      const screenX = logicalPosition.x + pointX;
      const screenY = logicalPosition.y + pointY;

      await win.setSize(new LogicalSize(nextWidth, nextHeight));
      await win.setPosition(
        new LogicalPosition(
          screenX - fractionX * nextWidth,
          screenY - fractionY * nextHeight
        )
      );
      setZoom(nextZoom);
    },
    [payload, win]
  );

  const zoomAroundCenter = useCallback(
    async (factor: number) => {
      const scaleFactor = await win.scaleFactor();
      const size = await win.innerSize();
      const logicalSize = size.toLogical(scaleFactor);

      await zoomAroundPoint(
        factor,
        logicalSize.width / 2,
        logicalSize.height / 2
      );
    },
    [win, zoomAroundPoint]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void closeWindow();
        return;
      }

      if (!event.metaKey && !event.ctrlKey) return;

      if (
        event.key === "0" ||
        event.code === "Digit0" ||
        event.code === "Numpad0"
      ) {
        event.preventDefault();
        void resetZoom();
        return;
      }

      if (
        event.key === "+" ||
        event.key === "=" ||
        event.code === "NumpadAdd"
      ) {
        event.preventDefault();
        void zoomAroundCenter(KEYBOARD_ZOOM_FACTOR);
        return;
      }

      if (
        event.key === "-" ||
        event.key === "_" ||
        event.code === "NumpadSubtract"
      ) {
        event.preventDefault();
        void zoomAroundCenter(1 / KEYBOARD_ZOOM_FACTOR);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeWindow, resetZoom, zoomAroundCenter]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * ZOOM_STEP);
    void zoomAroundPoint(factor, event.clientX, event.clientY);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-pin-control]")
    ) {
      return;
    }

    setContextMenu(null);
    void win.startDragging();
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenu({ left: event.clientX, top: event.clientY });
  };

  if (!payload) {
    return <div className="pin-window-shell" />;
  }

  return (
    <div
      className="pin-window-shell"
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
    >
      <div className="pin-window-frame">
        <img
          className="pin-window-image"
          src={imageUrl}
          alt=""
          draggable={false}
          onLoad={() => {
            void win.show().then(() => win.setFocus().catch(() => {}));
          }}
        />
      </div>

      <div className="pin-window-controls" data-pin-control>
        <button
          className="pin-window-zoom"
          type="button"
          title={t("screenshot.pin.resetZoom")}
          onClick={() => void resetZoom()}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="pin-window-button"
          type="button"
          title={t("screenshot.pin.resetZoom")}
          onClick={() => void resetZoom()}
        >
          <RotateCcw size={15} />
        </button>
        <button
          className="pin-window-button"
          type="button"
          title={t("screenshot.pin.copy")}
          onClick={() => void copyImage()}
        >
          <Copy size={15} />
        </button>
        <button
          className="pin-window-button"
          type="button"
          title={t("screenshot.pin.save")}
          onClick={() => void saveImage()}
        >
          <Download size={15} />
        </button>
        <button
          className="pin-window-button danger"
          type="button"
          title={t("screenshot.pin.close")}
          onClick={() => void closeWindow()}
        >
          <X size={15} />
        </button>
      </div>

      {contextMenu && (
        <div
          className="pin-context-menu"
          data-pin-control
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <button type="button" onClick={() => void copyImage()}>
            {t("screenshot.pin.copy")}
          </button>
          <button type="button" onClick={() => void saveImage()}>
            {t("screenshot.pin.save")}
          </button>
          <button type="button" onClick={() => void closeWindow()}>
            {t("screenshot.pin.close")}
          </button>
        </div>
      )}
    </div>
  );
}
