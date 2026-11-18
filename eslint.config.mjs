import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const STORAGE_MESSAGE =
  "Direct web storage access renders different markup on server and client, and is invisible to wipeLocalUserData(). " +
  "Use a load*/save* helper in src/lib/storage.ts, or useLocalValue() / useCachedState() in a component.";

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
    // Agent worktrees are full checkouts with their own builds; lint each in place.
    ".claude/worktrees/**",
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
  // Web storage goes through src/lib/storage.ts or useLocalValue(), never directly.
  {
    rules: {
      "no-restricted-globals": [
        "error",
        ...["localStorage", "sessionStorage"].map((name) => ({ name, message: STORAGE_MESSAGE })),
      ],
      "no-restricted-properties": [
        "error",
        ...["localStorage", "sessionStorage"].flatMap((property) =>
          ["window", "globalThis", "self"].map((object) => ({ object, property, message: STORAGE_MESSAGE }))
        ),
      ],
    },
  },
  {
    files: [
      "src/lib/storage.ts",
      "src/lib/useLocalValue.ts",
      // Device preferences, each owned by its module.
      "src/lib/haptics.ts",
      "src/lib/buddy.ts",
      "src/lib/whatsNew.ts",
    ],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
]);

export default eslintConfig;
