import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto"

const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MAX_MEMORY = 64 * 1024 * 1024

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, key) => {
        if (error) reject(error)
        else resolve(key)
      },
    )
  })

/**
 * Store the scrypt parameters next to the hash so they can be raised later
 * without invalidating existing accounts. No plaintext password is ever stored
 * or logged.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt)
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$")
}

export const verifyPassword = async (
  password: string,
  stored: string,
): Promise<boolean> => {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const cost = Number.parseInt(parts[1] ?? "", 10)
  const blockSize = Number.parseInt(parts[2] ?? "", 10)
  const parallelization = Number.parseInt(parts[3] ?? "", 10)
  const salt = Buffer.from(parts[4] ?? "", "base64url")
  const expected = Buffer.from(parts[5] ?? "", "base64url")
  if (
    !Number.isSafeInteger(cost) ||
    !Number.isSafeInteger(blockSize) ||
    !Number.isSafeInteger(parallelization) ||
    salt.length === 0 ||
    expected.length !== KEY_LENGTH
  ) {
    return false
  }

  try {
    const actual = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        KEY_LENGTH,
        {
          N: cost,
          r: blockSize,
          p: parallelization,
          maxmem: MAX_MEMORY,
        },
        (error, key) => {
          if (error) reject(error)
          else resolve(key)
        },
      )
    })
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    )
  } catch {
    return false
  }
}
