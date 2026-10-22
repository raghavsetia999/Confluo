
import {
  Circle,
  FabricObject,
  IText,
  Rect,
} from "fabric";

export function assignObjectId<T extends FabricObject>(object: T): T {
  object.set("id", crypto.randomUUID());
  return object;
}

export function createRectangle(): Rect {
  return assignObjectId(
    new Rect({
      left: 100,
      top: 100,
      width: 180,
      height: 110,
      rx: 8,
      ry: 8,
      fill: "#bfdbfe",
      stroke: "#3b82f6",
      strokeWidth: 1,
    })
  );
}

export function createCircle(): Circle {
  return assignObjectId(
    new Circle({
      left: 150,
      top: 150,
      radius: 55,
      fill: "#bbf7d0",
      stroke: "#059669",
      strokeWidth: 1,
    })
  );
}

export function createText(): IText {
  return assignObjectId(
    new IText("Double-click to edit", {
      left: 200,
      top: 200,
      fontSize: 24,
      fill: "#0f172a",
      fontFamily: "Arial",
    })
  );
}
