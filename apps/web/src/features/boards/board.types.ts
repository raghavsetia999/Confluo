
export interface BoardDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  fabricJSON: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBoardInput {
  name?: string;
}
