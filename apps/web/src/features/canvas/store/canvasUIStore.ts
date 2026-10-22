
import { create } from "zustand";
import type { CanvasTool } from "../canvas.types";

interface CanvasUIState {
  activeTool: CanvasTool;
  zoom: number;
  selectedObjectId: string | null;

  setActiveTool: (tool: CanvasTool) => void;
  setZoom: (zoom: number) => void;
  setSelectedObjectId: (id: string | null) => void;
}

export const useCanvasUIStore = create<CanvasUIState>((set) => ({
  activeTool: "select",
  zoom: 1,
  selectedObjectId: null,

  setActiveTool: (activeTool) => set({ activeTool }),
  setZoom: (zoom) => set({ zoom }),
  setSelectedObjectId: (selectedObjectId) =>
    set({ selectedObjectId }),
}));
