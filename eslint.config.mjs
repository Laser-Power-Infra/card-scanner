import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * This project deliberately does not install `eslint-config-next` (see plan
 * 01-01 Task 2): at the pinned Next 15.5.26 it is still eslintrc-format and
 * bridging it through `FlatCompat` trips a circular-structure TypeError from
 * the self-referencing `eslint-plugin-react-hooks` entry in `next/core-web-vitals`.
 *
 * That reason covers the *preset*, not the two plugins. `@next/eslint-plugin-next`
 * and `eslint-plugin-react-hooks` both expose their rules as plain objects and
 * are registered directly below, so `@next/next/no-img-element` and
 * `react-hooks/exhaustive-deps` are now the real rules rather than the no-op
 * stubs this file used to register. The four inline disable directives that
 * name them (app/page.tsx, components/ProfileSlideOver.tsx x2,
 * components/ScannerStage.tsx) still resolve, and now suppress a real report
 * instead of suppressing nothing.
 *
 * `@next/eslint-plugin-next` is pinned to the installed Next minor
 * (`next` is 15.5.26). `eslint-plugin-react-hooks` is on 7.x because 5.x and
 * 6.x both declare a peer range that stops at ESLint 9, and this repo runs
 * ESLint 10.
 */

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "lib/generated/**",
      "data/**",
      ".planning/**",
      "next-env.d.ts",
    ],
  },
  // The four disable directives in app/ and components/ each suppress a real
  // report now, so none of them is "unused" and this can be an error: a
  // directive that later stops suppressing anything is then a gate failure
  // rather than a warning nobody reads.
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      // The auth and scan modules carry `any` casts today (lib/auth.ts,
      // app/api/scan/route.ts). Downgraded, not deleted, so the debt stays
      // visible in the lint output.
      "@typescript-eslint/no-explicit-any": "warn",
      // scripts/*.ts are run through `tsx` and use an inline `require("fs")`
      // to write their report file. Downgraded, not deleted, so it stays
      // visible without failing the gate.
      "@typescript-eslint/no-require-imports": "warn",
      // ignoreRestSiblings keeps the omit-a-key idiom
      // (`const { rawNotes, ...leanContact } = payload.contact` in
      // lib/queue/profileCollection.ts) from reading as a dead variable,
      // without silencing any other unused variable.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
      // Real rules, not stubs. A stale-closure effect or a raw <img> that is
      // not one of the four sanctioned sites now fails `npm run lint`.
      "react-hooks/exhaustive-deps": "error",
      "@next/next/no-img-element": "error",
    },
  },
  {
    // Ambient declaration files import names to pull in the types they augment
    // and to be recognised as modules; those imports are load-bearing even
    // though nothing in the file body references them.
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
    },
  }
);
