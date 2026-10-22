
import { useFabricCanvas } from "./hooks/useFabricCanvas";
import type { CanvasHandle } from "./canvas.types";

interface CanvasProps {
  initialJSON: Record<string, unknown> | null;
  onReady: (handle: CanvasHandle | null) => void;
  onChange: (json: Record<string, unknown>) => void;
}

export default function Canvas({
  initialJSON,
  onReady,
  onChange,
}: CanvasProps) {
  const { elementRef, containerRef } = useFabricCanvas({
    initialJSON,
    onReady,
    onChange,
  });

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
    >
      <canvas ref={elementRef} />
    </div>
  );
}
