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
  // One Brzycki: the e1RM formula lives in src/lib/e1rm.ts. Matches any division by
  // (37 - …), so both `36 / (37 - reps)` and `kg * 36 / (37 - reps)` are caught.
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/lib/e1rm.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator='/'][right.type='BinaryExpression'][right.operator='-'][right.left.type='Literal'][right.left.value=37]",
          message:
            "This re-implements Brzycki e1RM, which lives in src/lib/e1rm.ts (calcE1RM, or calcE1RMFromRepsInTank for unrounded maths with RIR); a second copy drifts. Import it instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
