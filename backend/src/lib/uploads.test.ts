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
