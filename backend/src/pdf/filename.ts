import { contentDisposition } from "../lib/http.js";

export function contentDispositionPdf(name: string, inline = true): string {
  return contentDisposition(name, "pdf", inline);
}
