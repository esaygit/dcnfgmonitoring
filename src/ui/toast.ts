import { $ } from "../dom";

const status = $<HTMLParagraphElement>("#status");
let messageTimeout: ReturnType<typeof setTimeout> | undefined;

/** Shows a status message. duration 0 keeps it until the next message. */
export function message(text = "", kind: "" | "error" | "success" = "", duration = 5000) {
  if (messageTimeout) clearTimeout(messageTimeout);
  status.textContent = text;
  status.className = `status ${kind}`;
  if (text && duration > 0) {
    messageTimeout = setTimeout(() => {
      status.textContent = "";
      status.className = "status";
      messageTimeout = undefined;
    }, duration);
  } else {
    messageTimeout = undefined;
  }
}
