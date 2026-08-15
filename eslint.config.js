import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/* Type-aware linting is the point of this config. The rules that matter here
   (no-floating-promises above all) need the type checker to see that a promise
   was created and dropped, which is the shape of the worst bug this repo has
   had. Files outside a tsconfig get the same rules minus those. */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "coverage/**", "fixtures/**", "docs/**"],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
    },
  },

  {
    files: ["apps/web/**/*.tsx"],
    ...reactHooks.configs["recommended-latest"],
  },

  /* Tests and tool configs sit outside the build tsconfigs, and the scripts are
     plain JavaScript, so none of them has a program to check against. */
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/vitest.config.ts", "scripts/**/*.mjs", "*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },

  prettier,
);
