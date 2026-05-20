import { getToken } from "./api";

/**
 * Загружает файл с авторизацией. Возвращает {blob, filename}.
 * Имя файла парсится из Content-Disposition (RFC 5987 filename*=UTF-8'').
 */
export async function fetchAuthorizedBlob(url: string, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!r.ok) {
    let errText = `HTTP ${r.status}`;
    try {
      const json = await r.clone().json();
      if ((json as { message?: string }).message) errText = (json as { message: string }).message;
    } catch {
      // not JSON, leave fallback
    }
    throw new Error(errText);
  }
  const blob = await r.blob();
  const cd = r.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = m ? decodeURIComponent(m[1]!) : fallbackName;
  return { blob, filename };
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
