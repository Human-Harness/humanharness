// Image files bundled with the UI (Vite turns the import into the file's URL).
declare module "*.gif" {
  const src: string;
  export default src;
}
