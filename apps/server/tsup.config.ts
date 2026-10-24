import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Keep one Yjs implementation for both the server hooks and the shared B1
  // helpers. The local PGlite adapter is dev-only; production uses pg.
  external: ["@electric-sql/pglite", "yjs"],
})
