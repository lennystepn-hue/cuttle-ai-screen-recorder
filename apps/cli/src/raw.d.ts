// Files bundled as text by Vite (`import guide from '…/project.md?raw'`).
declare module '*?raw' {
  const text: string;
  export default text;
}
