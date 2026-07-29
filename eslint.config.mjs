import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Un `<a href="/…">` que navega en la MISMA pestaña recarga la app entera: se pierde
// el estado del cliente y la navegación pasa de instantánea a un round-trip completo.
// Ya pasó (PR #85 convirtió 15 de estos a `<Link>`), así que acá va el guardrail.
// `no-html-link-for-pages` de eslint-config-next NO sirve: sólo mira `pages/`, y esta
// app es App Router — verificado, no dispara.
//
// Se exceptúa `target` (típicamente `_blank`) a propósito: eso abre un documento nuevo
// igual, no hay recarga de la SPA que evitar, así que `<a target="_blank">` no es el
// bug. Una regla que marca cosas que no son bugs se termina desactivando.
//
// Sólo alcanza a los href literales; `href={item.href}` no se puede juzgar estático.
const INTERNAL_ANCHOR_MESSAGE =
  'Usá <Link> de next/link para navegar dentro de la app: un <a> interno en la misma pestaña recarga la página entera. Para salir del sitio, agregá target="_blank".'

const noInternalRawAnchor = [
  {
    // <a href="/dashboard">  (el lookahead deja pasar "//host", que es externo)
    selector:
      "JSXOpeningElement[name.name='a']:not(:has(JSXAttribute[name.name='target'])) JSXAttribute[name.name='href'] Literal[value=/^\\/(?!\\/)/]",
    message: INTERNAL_ANCHOR_MESSAGE,
  },
  {
    // <a href={`/dashboard/${id}`}>
    selector:
      "JSXOpeningElement[name.name='a']:not(:has(JSXAttribute[name.name='target'])) JSXAttribute[name.name='href'] TemplateLiteral[quasis.0.value.raw=/^\\/(?!\\/)/]",
    message: INTERNAL_ANCHOR_MESSAGE,
  },
]

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...noInternalRawAnchor],
    },
  },
  // Test files legitimately use `any` and bare function types for mocks/stubs.
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
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
