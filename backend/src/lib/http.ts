// HTTP-хелперы общего назначения.

function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/[\/\\:"*?<>|]/g, "_");
}

/**
 * Формирует Content-Disposition по RFC 5987 (ASCII fallback + filename* в UTF-8).
 * Используется для отдачи файлов с кириллическими именами.
 */
export function contentDisposition(name: string, ext: string, inline = true): string {
  const disp = inline ? "inline" : "attachment";
  const full = `${name}.${ext}`;
  const ascii = asciiFallback(full);
  const utf8 = encodeURIComponent(full);
  return `${disp}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
