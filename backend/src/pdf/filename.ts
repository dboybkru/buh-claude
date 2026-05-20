// Безопасное имя файла для HTTP-заголовка Content-Disposition.
// HTTP-заголовки ASCII-only — для кириллицы используем RFC 5987 (filename*=UTF-8''...).

function asciiFallback(name: string): string {
  // Заменяем не-ASCII символы и спецсимволы, не подходящие для файла, на _
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/[\/\\:"*?<>|]/g, "_");
}

export function contentDispositionPdf(name: string, inline = true): string {
  const disp = inline ? "inline" : "attachment";
  const ascii = `${asciiFallback(name)}.pdf`;
  const utf8 = encodeURIComponent(`${name}.pdf`);
  return `${disp}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
