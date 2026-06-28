import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Downgrade new React 19 rules — setState in effects is standard for
      // data fetching and localStorage hydration; helper components inside
      // render are intentional non-stateful wrappers.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored agent skills (installed via `npx skills add`) and SDD scratch —
    // third-party/local files, not part of the app; don't lint them.
    ".agents/**",
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
