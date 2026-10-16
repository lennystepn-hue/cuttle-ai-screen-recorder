// Vite asset URL imports (the fonts). Vite resolves them in tests and bundles.
declare module '*?url' {
  const url: string;
  export default url;
}
