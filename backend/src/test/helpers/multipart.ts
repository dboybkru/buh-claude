// Утилита для сборки multipart/form-data тела для fastify inject().
// Используется в integration-тестах bank-import (preview).

import { randomBytes } from "node:crypto";

export interface MultipartTextField {
  name: string;
  value: string;
}

export interface MultipartFile {
  name: string;
  filename: string;
  contentType?: string;
  value: Buffer;
}

export type MultipartPart = MultipartTextField | MultipartFile;

function isFile(p: MultipartPart): p is MultipartFile {
  return (p as MultipartFile).filename !== undefined && Buffer.isBuffer((p as MultipartFile).value);
}

export function buildMultipart(parts: MultipartPart[]): { body: Buffer; contentType: string } {
  const boundary = "----test-" + randomBytes(8).toString("hex");
  const CRLF = Buffer.from("\r\n");
  const segments: Buffer[] = [];
  for (const part of parts) {
    segments.push(Buffer.from(`--${boundary}\r\n`));
    if (isFile(part)) {
      segments.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
        `Content-Type: ${part.contentType ?? "application/octet-stream"}\r\n\r\n`,
      ));
      segments.push(part.value);
      segments.push(CRLF);
    } else {
      segments.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
      ));
    }
  }
  segments.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(segments),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
