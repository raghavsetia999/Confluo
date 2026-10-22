
import {
  Canvas as FabricCanvas,
  FabricObject,
} from "fabric";

FabricObject.customProperties = [
  ...new Set([
    ...FabricObject.customProperties,
    "id",
  ]),
];

export function serializeCanvas(
  canvas: FabricCanvas
): Record<string, unknown> {
  return canvas.toJSON();
}

export async function restoreCanvas(
  canvas: FabricCanvas,
  json: Record<string, unknown> | null
): Promise<void> {
  if (!json) return;

  await canvas.loadFromJSON(json);
  canvas.requestRenderAll();
}
