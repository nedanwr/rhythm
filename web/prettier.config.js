/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
export default {
  semi: true,
  singleQuote: false,
  trailingComma: "none",
  jsxSingleQuote: false,
  tabWidth: 2,
  useTabs: false,
  arrowParens: "always",
  bracketSpacing: true,
  bracketSameLine: false,
  plugins: ["prettier-plugin-tailwindcss"]
};
