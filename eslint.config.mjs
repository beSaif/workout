import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // KV is reached through one module only.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@vercel/kv",
              message:
                "Import KV through src/lib/server/db.ts: it normalises legacy session docs and keeps validation in one place. Add a helper there if you need a new read/write.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/server/db.ts"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
