import { useEffect, useRef } from "react";
import { Canvas as FabricCanvas, FabricObject, Point } from "fabric";

import type { CanvasHandle, CanvasTool } from "../canvas.types";

import {
  createCircle,
  createRectangle,
  createText,
} from "../lib/fabricObjects";

import { serializeCanvas } from "../lib/fabricSerialization";
import { useCanvasUIStore } from "../store/canvasUIStore";

interface Options {
  initialJSON: Record<string, unknown> | null;
  onReady: (handle: CanvasHandle | null) => void;
  onChange: (json: Record<string, unknown>) => void;
}

function getClientPosition(
  event: Event,
): { clientX: number; clientY: number } | null {
  if (event instanceof MouseEvent || event instanceof PointerEvent) {
    return {
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  return null;
}

export function useFabricCanvas({ initialJSON, onReady, onChange }: Options) {
  const elementRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const callbacksRef = useRef({ onReady, onChange });
  const initialJSONRef = useRef(initialJSON);

  useEffect(() => {
    callbacksRef.current = { onReady, onChange };
  }, [onReady, onChange]);

  useEffect(() => {
    initialJSONRef.current = initialJSON;
  }, [initialJSON]);

  useEffect(() => {
    const element = elementRef.current;
    const container = containerRef.current;

    if (!element || !container) return;

    let disposed = false;
    let restoring = true;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    let activeTool: CanvasTool = "select";
    let isPanning = false;
    let lastX = 0;
    let lastY = 0;

    const canvas = new FabricCanvas(element, {
      backgroundColor: "#f8fafc",
      selection: true,
      preserveObjectStacking: true,
    });

    FabricObject.customProperties = [
      ...new Set([...FabricObject.customProperties, "id"]),
    ];

    const setToolState = useCanvasUIStore.getState().setActiveTool;
    const setZoom = useCanvasUIStore.getState().setZoom;
    const setSelectedId = useCanvasUIStore.getState().setSelectedObjectId;

    const resize = () => {
      if (disposed) return;

      canvas.setDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });

      canvas.requestRenderAll();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const scheduleSave = () => {
      if (restoring || disposed) return;

      clearTimeout(saveTimer);

      saveTimer = setTimeout(() => {
        if (!disposed) {
          callbacksRef.current.onChange(serializeCanvas(canvas));
        }
      }, 250);
    };

    const syncZoom = () => {
      setZoom(canvas.getZoom());
    };

    const onSelection = () => {
      const active = canvas.getActiveObject();
      const id = active?.get("id");

      setSelectedId(typeof id === "string" ? id : null);
    };

    canvas.on("object:added", scheduleSave);
    canvas.on("object:removed", scheduleSave);
    canvas.on("object:modified", scheduleSave);
    canvas.on("text:changed", scheduleSave);

    canvas.on("selection:created", onSelection);
    canvas.on("selection:updated", onSelection);
    canvas.on("selection:cleared", onSelection);

    canvas.on("mouse:wheel", ({ e }) => {
      e.preventDefault();
      e.stopPropagation();

      const zoom = Math.max(
        0.1,
        Math.min(5, canvas.getZoom() * Math.exp(-e.deltaY * 0.001)),
      );

      const rect = canvas.upperCanvasEl.getBoundingClientRect();

      canvas.zoomToPoint(
        new Point(e.clientX - rect.left, e.clientY - rect.top),
        zoom,
      );

      syncZoom();
      canvas.requestRenderAll();
    });

    const endPan = () => {
      if (!isPanning) return;

      isPanning = false;
      canvas.selection = activeTool === "select";
      canvas.skipTargetFind = activeTool === "pan";
      canvas.defaultCursor = activeTool === "pan" ? "grab" : "default";
    };

    canvas.on("mouse:down", ({ e }) => {
      if (activeTool !== "pan" && !e.altKey) return;

      const position = getClientPosition(e);
      if (!position) return;

      isPanning = true;
      lastX = position.clientX;
      lastY = position.clientY;

      canvas.selection = false;
      canvas.discardActiveObject();
      canvas.defaultCursor = "grabbing";
      canvas.requestRenderAll();
    });

    canvas.on("mouse:move", ({ e }) => {
      if (!isPanning) return;

      const position = getClientPosition(e);
      if (!position) return;

      const viewport = canvas.viewportTransform;
      if (!viewport) return;

      const dx = position.clientX - lastX;
      const dy = position.clientY - lastY;

      canvas.setViewportTransform([
        viewport[0],
        viewport[1],
        viewport[2],
        viewport[3],
        viewport[4] + dx,
        viewport[5] + dy,
      ]);

      lastX = position.clientX;
      lastY = position.clientY;
    });

    canvas.on("mouse:up", endPan);

    const addObject = (object: FabricObject) => {
      const center = new Point(
        (canvas.getWidth() / 2 - (canvas.viewportTransform?.[4] ?? 0)) /
          canvas.getZoom(),
        (canvas.getHeight() / 2 - (canvas.viewportTransform?.[5] ?? 0)) /
          canvas.getZoom(),
      );

      object.set({
        left: center.x - (object.width ?? 0) / 2,
        top: center.y - (object.height ?? 0) / 2,
      });

      canvas.add(object);
      canvas.setActiveObject(object);
      canvas.requestRenderAll();
    };

    const handle: CanvasHandle = {
      addRectangle: () => addObject(createRectangle()),
      addCircle: () => addObject(createCircle()),
      addText: () => addObject(createText()),

      deleteSelected: () => {
        const selected = canvas.getActiveObjects();
        if (!selected.length) return;

        canvas.discardActiveObject();
        selected.forEach((object) => canvas.remove(object));
        canvas.requestRenderAll();
      },

      duplicateSelected: () => {
        const active = canvas.getActiveObject();
        if (!active) return;

        void active.clone().then((copy) => {
          if (disposed) return;

          copy.set({
            id: crypto.randomUUID(),
            left: (active.left ?? 0) + 24,
            top: (active.top ?? 0) + 24,
          });

          canvas.add(copy);
          canvas.setActiveObject(copy);
          canvas.requestRenderAll();
        });
      },

      setTool: (tool) => {
        activeTool = tool;
        setToolState(tool);
        endPan();

        canvas.selection = tool === "select";
        canvas.skipTargetFind = tool === "pan";
        canvas.defaultCursor = tool === "pan" ? "grab" : "default";

        canvas.discardActiveObject();
        canvas.requestRenderAll();
      },

      getJSON: () => serializeCanvas(canvas),

      dispose: () => {
        disposed = true;
        clearTimeout(saveTimer);
        observer.disconnect();
        void canvas.dispose();
      },
    };

    async function initialize() {
      try {
        const json = initialJSONRef.current;

        if (json) {
          await canvas.loadFromJSON(json);
        }

        if (disposed) return;

        restoring = false;
        syncZoom();
        canvas.requestRenderAll();
        callbacksRef.current.onReady(handle);
      } catch (error) {
        console.error("Unable to restore board", error);
      }
    }

    void initialize();

    return () => {
      disposed = true;
      clearTimeout(saveTimer);
      observer.disconnect();
      callbacksRef.current.onReady(null);
      void canvas.dispose();
    };
  }, []);

  return { elementRef, containerRef };
}
