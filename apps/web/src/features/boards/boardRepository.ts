
import type {
  BoardDocument,
  CreateBoardInput,
} from "./board.types";

export interface BoardRepository {
  getAll(): Promise<BoardDocument[]>;
  getById(id: string): Promise<BoardDocument | null>;
  create(input?: CreateBoardInput): Promise<BoardDocument>;
  save(board: BoardDocument): Promise<void>;
  delete(id: string): Promise<void>;
}

const PREFIX = "confluo:board:";

function readBoard(raw: string): BoardDocument {
  const value: unknown = JSON.parse(raw);

  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !("name" in value) ||
    !("schemaVersion" in value) ||
    !("fabricJSON" in value)
  ) {
    throw new Error("Invalid saved board document");
  }

  const board = value as BoardDocument;

  if (
    board.schemaVersion !== 1 ||
    typeof board.id !== "string" ||
    typeof board.name !== "string"
  ) {
    throw new Error("Unsupported board document");
  }

  return board;
}

class LocalBoardRepository implements BoardRepository {
  async getAll(): Promise<BoardDocument[]> {
    const boards: BoardDocument[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (!key?.startsWith(PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        boards.push(readBoard(raw));
      } catch (error) {
        console.error(`Could not read board ${key}`, error);
      }
    }

    return boards.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async getById(id: string): Promise<BoardDocument | null> {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? readBoard(raw) : null;
  }

  async create(input: CreateBoardInput = {}): Promise<BoardDocument> {
    const now = new Date().toISOString();

    const board: BoardDocument = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      name: input.name?.trim() || "Untitled Board",
      fabricJSON: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.save(board);
    return board;
  }

  async save(board: BoardDocument): Promise<void> {
    try {
      localStorage.setItem(
        PREFIX + board.id,
        JSON.stringify(board)
      );
    } catch (error) {
      console.error("Could not save board", error);
      throw new Error(
        "Unable to save this board. Browser storage may be full."
      );
    }
  }

  async delete(id: string): Promise<void> {
    localStorage.removeItem(PREFIX + id);
  }
}

export const boardRepository: BoardRepository =
  new LocalBoardRepository();
