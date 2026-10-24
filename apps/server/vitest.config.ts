import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// The web collaboration helpers are imported into the server tests as source.
// Resolve the workspace's single Yjs copy so constructor identity checks hold.
const serverYjs = fileURLToPath(import.meta.resolve("yjs"))

export default defineConfig({
  resolve: {
    alias: {
      yjs: serverYjs,
    },
  },
  test: {
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
