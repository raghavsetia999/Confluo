import { afterEach, describe, expect, it } from "vitest"
import { verifyPassword } from "../src/auth/password.ts"
import type { Database } from "../src/db/database.ts"
import {
  createTestDatabase,
  startTestHttp,
  type TestHttp,
} from "./helpers.ts"

interface AuthUserResponse {
  user: { id: string; name: string; email: string; createdAt: string }
  csrfToken: string
}

interface BoardResponse {
  board: {
    id: string
    title: string
    ownerId: string
    role: "owner" | "editor"
    createdAt: string
    updatedAt: string
  }
}

interface Session {
  cookie: string
  csrf: string
  user: AuthUserResponse["user"]
}

const cleanups: Array<() => Promise<void> | void> = []
const databases: Database[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  while (databases.length > 0) await databases.pop()?.close()
})

const database = async (): Promise<Database> => {
  const db = await createTestDatabase()
  databases.push(db)
  return db
}

const http = async (db: Database): Promise<TestHttp> => {
  const server = await startTestHttp(db)
  cleanups.push(() => server.close())
  return server
}

const readCookie = (response: Response): string => {
  const setCookie = response.headers.get("set-cookie")
  expect(setCookie).toBeTruthy()
  return setCookie!.split(";")[0]!
}

const register = async (
  server: TestHttp,
  email: string,
  name = "Test Person",
  password = "correct-horse-battery",
): Promise<Session> => {
  const response = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as AuthUserResponse
  return {
    cookie: readCookie(response),
    csrf: body.csrfToken,
    user: body.user,
  }
}

const login = async (
  server: TestHttp,
  email: string,
  password = "correct-horse-battery",
): Promise<Session> => {
  const response = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as AuthUserResponse
  return {
    cookie: readCookie(response),
    csrf: body.csrfToken,
    user: body.user,
  }
}

const headers = (
  session: Session,
  includeCsrf = true,
): Record<string, string> => ({
  Cookie: session.cookie,
  "Content-Type": "application/json",
  ...(includeCsrf ? { "X-CSRF-Token": session.csrf } : {}),
})

const createBoard = async (
  server: TestHttp,
  session: Session,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<BoardResponse["board"]> => {
  const response = await fetch(`${server.baseUrl}/api/boards`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ title, ...extra }),
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as BoardResponse).board
}

describe("accounts, sessions and CSRF", () => {
  it("registers, normalizes email, hashes passwords and rejects duplicates", async () => {
    const db = await database()
    const server = await http(db)

    const session = await register(
      server,
      "  ALICE@Example.COM ",
      "Alice Example",
    )
    expect(session.user.email).toBe("alice@example.com")

    const stored = await db.query<{ passwordHash: string }>(
      `SELECT password_hash AS "passwordHash" FROM users WHERE email = $1`,
      ["alice@example.com"],
    )
    const hash = stored.rows[0]?.passwordHash ?? ""
    expect(hash).not.toContain("correct-horse-battery")
    expect(hash.startsWith("scrypt$")).toBe(true)
    await expect(verifyPassword("correct-horse-battery", hash)).resolves.toBe(
      true,
    )
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false)

    const duplicate = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice Again",
        email: "alice@example.com",
        password: "another-password",
      }),
    })
    expect(duplicate.status).toBe(409)
  })

  it("logs in, restores a session, enforces CSRF and logs out", async () => {
    const db = await database()
    const server = await http(db)
    await register(server, "alice@example.com")

    const wrong = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "not-the-password",
      }),
    })
    expect(wrong.status).toBe(401)

    const session = await login(server, "alice@example.com")
    const restored = await fetch(`${server.baseUrl}/api/auth/session`, {
      headers: { Cookie: session.cookie },
    })
    expect(restored.status).toBe(200)
    const restoredBody = (await restored.json()) as AuthUserResponse
    expect(restoredBody.user.id).toBe(session.user.id)
    expect(restoredBody.csrfToken).toBe(session.csrf)

    const withoutCsrf = await fetch(`${server.baseUrl}/api/boards`, {
      method: "POST",
      headers: headers(session, false),
      body: JSON.stringify({ title: "No token" }),
    })
    expect(withoutCsrf.status).toBe(403)

    const anonymous = await fetch(`${server.baseUrl}/api/boards`)
    expect(anonymous.status).toBe(401)

    const logout = await fetch(`${server.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: headers(session),
    })
    expect(logout.status).toBe(204)

    const afterLogout = await fetch(`${server.baseUrl}/api/auth/session`, {
      headers: { Cookie: session.cookie },
    })
    const afterBody = (await afterLogout.json()) as { user: null }
    expect(afterBody.user).toBeNull()

    const stale = await fetch(`${server.baseUrl}/api/boards`, {
      headers: { Cookie: session.cookie },
    })
    expect(stale.status).toBe(401)
  })
})

describe("boards, membership and access control", () => {
  it("keeps boards private until a signed-in user joins by id", async () => {
    const db = await database()
    const server = await http(db)
    const alice = await register(server, "alice@example.com", "Alice")
    const bob = await register(server, "bob@example.com", "Bob")
    const carol = await register(server, "carol@example.com", "Carol")

    const board = await createBoard(server, alice, "Alice board", {
      ownerId: carol.user.id,
    })
    expect(board.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(board.ownerId).toBe(alice.user.id)
    expect(board.role).toBe("owner")

    const stored = await db.query<{ ownerId: string }>(
      `SELECT owner_id AS "ownerId" FROM boards WHERE id = $1`,
      [board.id],
    )
    expect(stored.rows[0]?.ownerId).toBe(alice.user.id)

    const aliceList = await fetch(`${server.baseUrl}/api/boards`, {
      headers: { Cookie: alice.cookie },
    })
    expect(
      ((await aliceList.json()) as { boards: BoardResponse["board"][] })
        .boards.map((item) => item.id),
    ).toContain(board.id)

    const bobListBefore = await fetch(`${server.baseUrl}/api/boards`, {
      headers: { Cookie: bob.cookie },
    })
    expect(
      ((await bobListBefore.json()) as { boards: unknown[] }).boards,
    ).toHaveLength(0)

    const privateRead = await fetch(
      `${server.baseUrl}/api/boards/${board.id}`,
      { headers: { Cookie: bob.cookie } },
    )
    expect(privateRead.status).toBe(404)

    const join = await fetch(`${server.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(bob),
      body: JSON.stringify({ boardId: board.id }),
    })
    expect(join.status).toBe(200)
    expect(((await join.json()) as BoardResponse).board.role).toBe("editor")

    const joinAgain = await fetch(`${server.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(bob),
      body: JSON.stringify({ boardId: board.id }),
    })
    expect(joinAgain.status).toBe(200)

    const bobListAfter = await fetch(`${server.baseUrl}/api/boards`, {
      headers: { Cookie: bob.cookie },
    })
    expect(
      ((await bobListAfter.json()) as { boards: BoardResponse["board"][] })
        .boards.map((item) => item.id),
    ).toEqual([board.id])

    const bobRename = await fetch(
      `${server.baseUrl}/api/boards/${board.id}`,
      {
        method: "PATCH",
        headers: headers(bob),
        body: JSON.stringify({ title: "Hijacked" }),
      },
    )
    expect(bobRename.status).toBe(403)
    const bobDelete = await fetch(
      `${server.baseUrl}/api/boards/${board.id}`,
      { method: "DELETE", headers: headers(bob) },
    )
    expect(bobDelete.status).toBe(403)

    const aliceRename = await fetch(
      `${server.baseUrl}/api/boards/${board.id}`,
      {
        method: "PATCH",
        headers: headers(alice),
        body: JSON.stringify({ title: "Renamed by owner" }),
      },
    )
    expect(aliceRename.status).toBe(200)
    expect(
      ((await aliceRename.json()) as BoardResponse).board.title,
    ).toBe("Renamed by owner")

    const unknownJoin = await fetch(`${server.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(carol),
      body: JSON.stringify({ boardId: "00000000-0000-4000-8000-000000000000" }),
    })
    expect(unknownJoin.status).toBe(404)

    const malformedJoin = await fetch(`${server.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(carol),
      body: JSON.stringify({ boardId: "../escape" }),
    })
    expect(malformedJoin.status).toBe(400)
  })

  it("isolates separate boards and does not grant access by joining one", async () => {
    const db = await database()
    const server = await http(db)
    const alice = await register(server, "alice@example.com", "Alice")
    const bob = await register(server, "bob@example.com", "Bob")

    const first = await createBoard(server, alice, "First")
    const second = await createBoard(server, alice, "Second")
    const join = await fetch(`${server.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(bob),
      body: JSON.stringify({ boardId: first.id }),
    })
    expect(join.status).toBe(200)

    const secondRead = await fetch(
      `${server.baseUrl}/api/boards/${second.id}`,
      { headers: { Cookie: bob.cookie } },
    )
    expect(secondRead.status).toBe(404)
    expect(first.id).not.toBe(second.id)
  })

  it("duplicates an accessible board into the caller's account", async () => {
    const db = await database()
    const server = await http(db)
    const alice = await register(server, "alice@example.com", "Alice")
    const bob = await register(server, "bob@example.com", "Bob")
    const source = await createBoard(server, alice, "Source board")
    await fetch(`${server.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(bob),
      body: JSON.stringify({ boardId: source.id }),
    })
    await db.query(
      `
        INSERT INTO board_documents
          (board_id, snapshot, snapshot_seq, schema_version)
        VALUES ($1, $2, 3, 1)
      `,
      [source.id, new Uint8Array([1, 2, 3, 4])],
    )

    const duplicate = await fetch(
      `${server.baseUrl}/api/boards/${source.id}/duplicate`,
      {
        method: "POST",
        headers: headers(bob),
        body: JSON.stringify({ title: "Bob's copy" }),
      },
    )
    expect(duplicate.status).toBe(201)
    const copied = ((await duplicate.json()) as BoardResponse).board
    expect(copied.id).not.toBe(source.id)
    expect(copied.ownerId).toBe(bob.user.id)
    expect(copied.role).toBe("owner")
    expect(copied.title).toBe("Bob's copy")

    const sourceOwner = await db.query<{ ownerId: string }>(
      `SELECT owner_id AS "ownerId" FROM boards WHERE id = $1`,
      [source.id],
    )
    expect(sourceOwner.rows[0]?.ownerId).toBe(alice.user.id)

    const copiedDocument = await db.query<{ snapshot: Uint8Array }>(
      "SELECT snapshot FROM board_documents WHERE board_id = $1",
      [copied.id],
    )
    expect(Array.from(copiedDocument.rows[0]?.snapshot ?? [])).toEqual([
      1, 2, 3, 4,
    ])
  })

  it("persists boards and memberships across an app restart", async () => {
    const db = await database()
    const firstServer = await http(db)
    const alice = await register(firstServer, "alice@example.com", "Alice")
    const bob = await register(firstServer, "bob@example.com", "Bob")
    const board = await createBoard(firstServer, alice, "Persistent")
    const join = await fetch(`${firstServer.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(bob),
      body: JSON.stringify({ boardId: board.id }),
    })
    expect(join.status).toBe(200)
    await firstServer.close()

    const secondServer = await http(db)
    const list = await fetch(`${secondServer.baseUrl}/api/boards`, {
      headers: { Cookie: bob.cookie },
    })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { boards: BoardResponse["board"][] }
    expect(body.boards).toHaveLength(1)
    expect(body.boards[0]?.id).toBe(board.id)
    expect(body.boards[0]?.role).toBe("editor")

    const read = await fetch(`${secondServer.baseUrl}/api/boards/${board.id}`, {
      headers: { Cookie: bob.cookie },
    })
    expect(read.status).toBe(200)
  })

  it("lets only the owner delete a board and cascades membership", async () => {
    const db = await database()
    const server = await http(db)
    const alice = await register(server, "alice@example.com", "Alice")
    const bob = await register(server, "bob@example.com", "Bob")
    const board = await createBoard(server, alice, "Temporary")
    await fetch(`${server.baseUrl}/api/boards/join`, {
      method: "POST",
      headers: headers(bob),
      body: JSON.stringify({ boardId: board.id }),
    })

    const removed = await fetch(`${server.baseUrl}/api/boards/${board.id}`, {
      method: "DELETE",
      headers: headers(alice),
    })
    expect(removed.status).toBe(204)

    const gone = await fetch(`${server.baseUrl}/api/boards/${board.id}`, {
      headers: { Cookie: bob.cookie },
    })
    expect(gone.status).toBe(404)

    const members = await db.query<{ count: string | number }>(
      "SELECT COUNT(*) AS count FROM board_memberships WHERE board_id = $1",
      [board.id],
    )
    expect(Number(members.rows[0]?.count ?? 0)).toBe(0)
  })
})
