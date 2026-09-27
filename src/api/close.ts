import { invoke } from "@tauri-apps/api/core";

export function setUnsaved(unsaved: boolean): Promise<void> {
  return invoke("set_unsaved", { unsaved });
}

export function ackClosePrompt(token: number): Promise<void> {
  return invoke("ack_close_prompt", { token });
}

export function resolveClose(token: number, allow: boolean): Promise<void> {
  return invoke("resolve_close", { token, allow });
}
