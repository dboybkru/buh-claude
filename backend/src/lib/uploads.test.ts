import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveSafeAssetPath, mimeTypeFor, MAX_FILE_BYTES } from "./uploads.js";

describe("uploads / resolveSafeAssetPath", () => {
  it("разрешает путь внутри userId-папки", () => {
    const userId = "user-1";
    const p = resolveSafeAssetPath(userId, `${userId}/org-1/logo.png`);
    expect(p).not.toBeNull();
    expect(p!.endsWith(path.normalize(`${userId}/org-1/logo.png`))).toBe(true);
  });
  it("блокирует path traversal через ..", () => {
    const userId = "user-1";
    const p = resolveSafeAssetPath(userId, `${userId}/../other-user/leak.png`);
    expect(p).toBeNull();
  });
  it("блокирует путь чужого пользователя", () => {
    const userId = "user-1";
    const p = resolveSafeAssetPath(userId, `user-2/org-1/x.png`);
    expect(p).toBeNull();
  });
  it("возвращает null на пустой путь", () => {
    expect(resolveSafeAssetPath("u", "")).toBeNull();
  });
});

describe("uploads / mimeTypeFor", () => {
  it("по расширению PNG/JPG/JPEG/WEBP", () => {
    expect(mimeTypeFor("a/b.png")).toBe("image/png");
    expect(mimeTypeFor("a/b.jpg")).toBe("image/jpeg");
    expect(mimeTypeFor("a/b.jpeg")).toBe("image/jpeg");
    expect(mimeTypeFor("a/b.webp")).toBe("image/webp");
    expect(mimeTypeFor("a/b.txt")).toBe("application/octet-stream");
  });
});

describe("uploads / limits", () => {
  it("MAX_FILE_BYTES = 5 MB", () => {
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
  });
});

// Sprint 5.1: mapAssets читает файл и возвращает data-URL — @react-pdf 4.x
// корректно работает только с data: URI, не с file:// или абсолютным путём.
describe("uploads + mapAssets / data URL", async () => {
  const { mapAssets } = await import("../pdf/map.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { uploadsRoot } = await import("./uploads.js");

  it("mapAssets возвращает null для отсутствующего файла", () => {
    const r = mapAssets({ logo: null, stamp: null, signature: null, inn: "x", name: "x" } as any, "u-none");
    expect(r.logoPath).toBeNull();
    expect(r.stampPath).toBeNull();
    expect(r.signaturePath).toBeNull();
  });

  it("mapAssets возвращает data:image/png;base64 для существующего PNG", async () => {
    const userId = "test-mapassets-user";
    const orgId = "test-org";
    const rel = `${userId}/${orgId}/logo.png`;
    const abs = path.join(uploadsRoot(), userId, orgId, "logo.png");
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // 1×1 прозрачный PNG (минимальный валидный)
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    await fs.writeFile(abs, pngBytes);
    try {
      const r = mapAssets({ logo: rel, inn: "x", name: "x" } as any, userId);
      expect(r.logoPath).toMatch(/^data:image\/png;base64,/);
    } finally {
      await fs.rm(path.dirname(abs), { recursive: true, force: true });
    }
  });
});
