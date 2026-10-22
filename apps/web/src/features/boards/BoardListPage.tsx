
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Plus, Trash2 } from "lucide-react";

import { boardRepository } from "./boardRepository";
import type { BoardDocument } from "./board.types";

export default function BoardListPage() {
  const navigate = useNavigate();

  const [boards, setBoards] = useState<BoardDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshBoards = useCallback(async () => {
    try {
      setError("");
      setBoards(await boardRepository.getAll());
    } catch (err) {
      console.error(err);
      setError("Unable to load boards.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBoards();
  }, [refreshBoards]);

  async function createBoard() {
    try {
      setError("");
      const board = await boardRepository.create();
      navigate(`/boards/${board.id}`);
    } catch (err) {
      console.error(err);
      setError("Unable to create a board.");
    }
  }

  async function deleteBoard(
    event: React.MouseEvent<HTMLButtonElement>,
    id: string
  ) {
    event.stopPropagation();

    if (!window.confirm("Delete this board permanently?")) {
      return;
    }

    try {
      await boardRepository.delete(id);
      await refreshBoards();
    } catch (err) {
      console.error(err);
      setError("Unable to delete this board.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <LayoutDashboard size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold">Confluo</h1>
              <p className="text-sm text-slate-500">
                Your collaborative workspace
              </p>
            </div>
          </div>

          <button
            onClick={() => void createBoard()}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
          >
            <Plus size={18} />
            New board
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Your boards</h2>
          <p className="mt-1 text-slate-500">
            Create a canvas for your next idea.
          </p>
        </div>

        {error && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-12 text-slate-500">Loading boards...</p>
        ) : boards.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
            <LayoutDashboard
              className="mx-auto mb-4 text-slate-400"
              size={40}
            />
            <h3 className="text-lg font-semibold">
              Start with a blank canvas
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Your boards will appear here.
            </p>
            <button
              onClick={() => void createBoard()}
              className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-white"
            >
              Create your first board
            </button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <div
                key={board.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/boards/${board.id}`)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" ||
                    event.key === " "
                  ) {
                    event.preventDefault();
                    navigate(`/boards/${board.id}`);
                  }
                }}
                className="cursor-pointer rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-6 flex items-center justify-between">
                  <div className="rounded-lg bg-blue-50 p-3 text-blue-600">
                    <LayoutDashboard size={22} />
                  </div>

                  <button
                    aria-label={`Delete ${board.name}`}
                    title="Delete board"
                    onClick={(event) =>
                      void deleteBoard(event, board.id)
                    }
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <h3 className="truncate font-semibold">
                  {board.name}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Updated{" "}
                  {new Date(board.updatedAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
