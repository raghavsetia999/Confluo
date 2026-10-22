
import {
  Canvas as FabricCanvas,
  Point,
} from "fabric";

export function zoomAtPointer(
  canvas: FabricCanvas,
  screenX: number,
  screenY: number,
  deltaY: number
): void {
  const nextZoom = Math.max(
    0.1,
    Math.min(5, canvas.getZoom() * Math.exp(-deltaY * 0.001))
  );

  canvas.zoomToPoint(
    new Point(screenX, screenY),
    nextZoom
  );

  canvas.requestRenderAll();
}

export function panBy(
  canvas: FabricCanvas,
  deltaX: number,
  deltaY: number
): void {
  const viewport = canvas.viewportTransform;
  if (!viewport) return;

  canvas.setViewportTransform([
    viewport[0],
    viewport[1],
    viewport[2],
    viewport[3],
    viewport[4] + deltaX,
    viewport[5] + deltaY,
  ]);
}

export function getViewportCenter(
  canvas: FabricCanvas
): Point {
  const viewport = canvas.viewportTransform;

  if (!viewport) {
    return new Point(
      canvas.getWidth() / 2,
      canvas.getHeight() / 2
    );
  }

  return new Point(
    (canvas.getWidth() / 2 - viewport[4]) / viewport[0],
    (canvas.getHeight() / 2 - viewport[5]) / viewport[3]
  );
}

export function resetViewport(canvas: FabricCanvas): void {
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.requestRenderAll();
}
