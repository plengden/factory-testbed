import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "data/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS Node scripts (CI helpers). TypeScript files get these from @types/node instead.
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly" },
    },
  },
  {
    rules: {
      // Constitution "Output": dynamic code runs only from code we wrote.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      // Suppressions are visible bar-lowering; CI's weakened-test check flags new ones too.
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
);
