import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, setCsrfToken } from "./apiClient.ts"
import { boardService } from "./boardService.ts"

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const apiBoard = {
  id: "7f4c9a54-0c3e-4b75-8f11-0bfee9f5a2a1",
  title: "Product discovery",
  ownerId: "user-a",
  role: "owner" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  setCsrfToken(null)
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

describe("boardService", () => {
  it("loads only server-provided board summaries", async () => {
    fetchMock.mockResolvedValueOnce(json({ boards: [apiBoard] }))

    const boards = await boardService.list()

    expect(boards).toHaveLength(1)
    expect(boards[0]).toMatchObject({
      id: apiBoard.id,
      title: apiBoard.title,
      permission: "owner",
      elements: [],
      members: [],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards"),
      expect.objectContaining({ credentials: "include", method: "GET" }),
    )
  })

  it("maps board members and keeps canvas elements Yjs-owned", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        board: { ...apiBoard, role: "editor" },
        members: [
          {
            userId: "user-b",
            name: "Bob",
            email: "bob@example.com",
            role: "editor",
            joinedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
      }),
    )

    const board = await boardService.get(apiBoard.id)

    expect(board.permission).toBe("editor")
    expect(board.elements).toEqual([])
    expect(board.members[0]).toMatchObject({
      userId: "user-b",
      boardId: apiBoard.id,
      role: "editor",
      status: "offline",
    })
  })

  it("sends CSRF-protected create and join requests", async () => {
    setCsrfToken("csrf-value")
    fetchMock
      .mockResolvedValueOnce(json({ board: apiBoard }, 201))
      .mockResolvedValueOnce(json({ board: apiBoard }))

    await boardService.create("Product discovery")
    await boardService.join(apiBoard.id)

    const createOptions = fetchMock.mock.calls[0]?.[1] as RequestInit
    const createHeaders = createOptions.headers as Headers
    expect(createOptions.method).toBe("POST")
    expect(createHeaders.get("X-CSRF-Token")).toBe("csrf-value")
    expect(createOptions.body).toBe(
      JSON.stringify({ title: "Product discovery" }),
    )

    const joinOptions = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(joinOptions.body).toBe(JSON.stringify({ boardId: apiBoard.id }))
  })

  it("surfaces safe server errors without inventing local success", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "Board not found" }, 404))
      .mockResolvedValueOnce(json({ error: "Board not found" }, 404))

    await expect(boardService.get("missing")).rejects.toMatchObject({
      name: "ApiError",
      message: "Board not found",
      status: 404,
    })
    await expect(boardService.get("missing")).rejects.toBeInstanceOf(ApiError)
  })
})
