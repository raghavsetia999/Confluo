
export type CanvasTool = "select" | "pan";

export type CanvasObjectType =
  | "rectangle"
  | "circle"
  | "text";

export interface CanvasHandle {
  addRectangle(): void;
  addCircle(): void;
  addText(): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  setTool(tool: CanvasTool): void;
  getJSON(): Record<string, unknown>;
  dispose(): void;
}
