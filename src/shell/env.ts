/**
 * Build-time environment flag.
 *
 * `vite dev` and `tauri dev` serve the app with `DEV = true`; `vite build` (and
 * therefore every packaged app) sets it to false. Used to keep the sample
 * document and the benchmark generator out of releases.
 */
export const IS_DEV = Boolean(
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV,
);
