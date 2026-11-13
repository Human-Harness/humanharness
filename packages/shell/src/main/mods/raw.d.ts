// A file imported as text (`./x?raw`): vite inlines it in the build, vitest reads it in tests.
declare module "*?raw" {
  const text: string;
  export default text;
}
