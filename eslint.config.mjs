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
  ]),
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
      // The sessionStorage resume hand-off between the mini player and Home; not yet
      // moved into storage.ts.
      "src/app/page.tsx",
      "src/components/MiniPlayerBar.tsx",
    ],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
]);

export default eslintConfig;
