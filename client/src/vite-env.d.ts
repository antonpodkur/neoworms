/** URLs of the private (dev-only) map images in maps/wr/; empty in production builds. */
declare module 'virtual:private-maps' {
  const urls: string[];
  export default urls;
}

interface ImportMetaEnv {
  /** Host of the deployed relay (e.g. neoworms-relay.example.workers.dev); unset means localhost:8787. */
  readonly VITE_RELAY_HOST?: string;
}
