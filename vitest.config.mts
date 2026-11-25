import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the "@/*" path in tsconfig.json.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside a React Server Components bundle; unit tests
      // import server modules (e.g. src/lib/validate.ts) directly, so stub it out.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // A fixed zone with DST, so the local-calendar-day maths in weight.ts is tested
    // the same way on every machine and in CI.
    env: { TZ: "Europe/Zurich" },
    include: ["src/**/*.test.ts"],
  },
})
