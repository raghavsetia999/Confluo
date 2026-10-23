import type { User } from "../types/user.ts"
import { browserPersistence, uid } from "./persistenceService.ts"

const USER_KEY = "confluo:session"
const ACCOUNTS_KEY = "confluo:accounts"

interface StoredAccount extends User {
  password: string
}

const wait = (milliseconds = 450) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export const authService = {
  current(): User | null {
    return browserPersistence.read<User | null>(USER_KEY, null)
  },
  async signup(name: string, email: string, password: string): Promise<User> {
    await wait()
    const accounts = browserPersistence.read<StoredAccount[]>(ACCOUNTS_KEY, [])
    if (
      accounts.some(
        (account) => account.email.toLowerCase() === email.toLowerCase(),
      )
    ) {
      throw new Error("An account with this email already exists.")
    }
    const user: StoredAccount = {
      id: uid("user"),
      name,
      email,
      password,
      createdAt: new Date().toISOString(),
    }
    browserPersistence.write(ACCOUNTS_KEY, [...accounts, user])
    browserPersistence.write(USER_KEY, user)
    return user
  },
  async login(email: string, password: string): Promise<User> {
    await wait()
    const accounts = browserPersistence.read<StoredAccount[]>(ACCOUNTS_KEY, [])
    const account = accounts.find(
      (candidate) =>
        candidate.email.toLowerCase() === email.toLowerCase() &&
        candidate.password === password,
    )
    if (!account) throw new Error("Email or password is incorrect.")
    browserPersistence.write(USER_KEY, account)
    return account
  },
  async resetPassword(email: string): Promise<void> {
    await wait()
    if (!email.includes("@")) throw new Error("Enter a valid email address.")
  },
  logout() {
    browserPersistence.remove(USER_KEY)
  },
}
