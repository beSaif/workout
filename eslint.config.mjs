import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Agent rules turned into lint rules. Every message names the root-cause fix, because
// the reader is usually an agent that will otherwise copy the pattern it just hit.
// The full table of rules, and the ones left as prose, is docs/agent-rules.md.

/** Code that drives a browser with Playwright: the smoke specs and the agent skills. */
const PLAYWRIGHT_FILES = ["e2e/**/*.{ts,mts,js,mjs}", ".claude/skills/**/*.{ts,mts,js,mjs}"];

const playwrightRestrictions = [
  {
    // Bit verify-workout in PR #146.
    selector:
      "CallExpression[callee.property.name='addCookies'] Property[key.name='domain'], CallExpression[callee.name='addCookies'] Property[key.name='domain']",
    message:
      "Use `url: <base URL>` instead of `domain:` in addCookies(): Playwright stores a `domain` cookie with a Domain attribute, which is a different cookie from the host-only one Auth.js sets and clears, so it survives sign-out. `url` stores it host-only, like a real sign-in.",
  },
  {
    selector: "Literal[value='networkidle']",
    message:
      'Do not wait for "networkidle": it never settles on Vercel previews (analytics and keep-alive requests keep the network busy). Wait for a specific locator or state instead, e.g. `await expect(page.getByRole(...)).toBeVisible()` or `waitUntil: "domcontentloaded"` followed by a locator.',
  },
  {
    // A `Host` key in a header object (`headers`, `extraHTTPHeaders`, setExtraHTTPHeaders(),
    // new Headers()) or `headers.set("Host", ...)`. Not `{ host }` in socket options.
    selector: [
      "Property[key.name=/^(headers|extraHTTPHeaders)$/] > ObjectExpression > Property[key.name=/^host$/i]",
      "Property[key.name=/^(headers|extraHTTPHeaders)$/] > ObjectExpression > Property[key.value=/^host$/i]",
      ":matches(CallExpression[callee.property.name='setExtraHTTPHeaders'], NewExpression[callee.name='Headers']) > ObjectExpression > Property[key.name=/^host$/i]",
      ":matches(CallExpression[callee.property.name='setExtraHTTPHeaders'], NewExpression[callee.name='Headers']) > ObjectExpression > Property[key.value=/^host$/i]",
      "CallExpression[callee.property.name=/^(set|append)$/][arguments.0.value=/^host$/i]",
    ].join(", "),
    message:
      "Do not override the Host header: Vercel's edge drops the TLS connection when Host is not the deployment's own hostname. Test host-based rules locally (against `next dev`/`next start`), never against a preview.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: PLAYWRIGHT_FILES,
    rules: {
      "no-restricted-syntax": ["error", ...playwrightRestrictions],
    },
  },
  {
    // AGENTS.md: "Heed deprecation notices". Needs type information, so only src/**.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
