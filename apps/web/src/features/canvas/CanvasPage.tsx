
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Square,
  Circle as CircleIcon,
  Type,
  MousePointer2,
  Hand,
  Trash2,
} from "lucide-react";

import Canvas from "./Canvas";
import type { CanvasHandle } from "./canvas.types";

import { boardRepository } from "../boards/boardRepository";
import type { BoardDocument } from "../boards/board.types";

export default function CanvasPage() {
  const { boardId } = useParams<{ boardId: string }>();

  const [board, setBoard] = useState<BoardDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState<"select" | "pan">("select");

  const canvasRef = useRef<CanvasHandle | null>(null);
  const boardRef = useRef<BoardDocument | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setBoard(null);
    boardRef.current = null;

    void (async () => {
      const result = boardId
        ? await boardRepository.getById(boardId)
        : null;

      if (cancelled) return;

      boardRef.current = result;
      setBoard(result);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId]);

  function savePatch(patch: Partial<BoardDocument>) {
    const current = boardRef.current;
    if (!current) return;

    const updated: BoardDocument = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    boardRef.current = updated;
    void boardRepository.save(updated);
  }

  function changeTool(next: "select" | "pan") {
    setTool(next);
    canvasRef.current?.setTool(next);
  }

  if (loading) return <div className="p-8">Loading...</div>;
  if (!board) return <div className="p-8">Board not found.</div>;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex h-16 items-center gap-4 border-b bg-white px-5">
        <Link to="/" aria-label="Back to dashboard">
          <ArrowLeft size={20} />
        </Link>

        <input
          defaultValue={board.name}
          aria-label="Board name"
          className="flex-1 font-semibold outline-none"
          onChange={(e) => savePatch({ name: e.target.value })}
        />

        <span className="text-sm text-slate-500">
          Auto-save
        </span>
      </header>

      <main className="relative min-h-0 flex-1">
        <Canvas
          initialJSON={board.fabricJSON}
          onReady={(handle) => {
            canvasRef.current = handle;
          }}
          onChange={(json) => {
            savePatch({ fabricJSON: json });
          }}
        />

        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl border bg-white p-3 shadow-lg">
          <button
            className={`rounded-lg p-2 ${tool === "select" ? "bg-blue-100" : ""}`}
            onClick={() => changeTool("select")}
            title="Select"
          >
            <MousePointer2 />
          </button>

          <button
            className={`rounded-lg p-2 ${tool === "pan" ? "bg-blue-100" : ""}`}
            onClick={() => changeTool("pan")}
            title="Pan"
          >
            <Hand />
          </button>

          <div className="mx-1 w-px bg-slate-200" />

          <button
            className="rounded-lg p-2 hover:bg-slate-100"
            onClick={() => canvasRef.current?.addRectangle()}
            title="Rectangle"
          >
            <Square />
          </button>

          <button
            className="rounded-lg p-2 hover:bg-slate-100"
            onClick={() => canvasRef.current?.addCircle()}
            title="Circle"
          >
            <CircleIcon />
          </button>

          <button
            className="rounded-lg p-2 hover:bg-slate-100"
            onClick={() => canvasRef.current?.addText()}
            title="Text"
          >
            <Type />
          </button>

          <div className="mx-1 w-px bg-slate-200" />

          <button
            className="rounded-lg p-2 hover:bg-red-50"
            onClick={() => canvasRef.current?.deleteSelected()}
            title="Delete selected"
          >
            <Trash2 />
          </button>
        </div>
      </main>
    </div>
  );
}
