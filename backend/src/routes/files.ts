// Эндпойнты для загрузки/удаления/получения изображений организации:
// логотип, печать, подпись. MVP — локальный диск backend/uploads/<userId>/...
// Все ручки требуют JWT и проверяют принадлежность файла пользователю.

import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/api-error.js";
import {
  saveOrgAsset,
  readAsset,
  deleteAsset,
  mimeTypeFor,
  MAX_FILE_BYTES,
  type AssetKind,
} from "../lib/uploads.js";

const kindSchema = z.enum(["logo", "stamp", "signature"]);

async function ensureOrgOwnership(userId: string, organizationId: string) {
  const org = await prisma.organization.findFirst({ where: { id: organizationId, userId } });
  if (!org) throw Errors.notFound("Организация");
  return org;
}

export async function filesRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES } });

  app.addHook("onRequest", app.authenticate);

  // POST /api/v1/files/organizations/:orgId/:kind — multipart с одним файлом.
  app.post("/organizations/:organizationId/:kind", async (request, reply) => {
    const { organizationId, kind } = z
      .object({ organizationId: z.string().uuid(), kind: kindSchema })
      .parse(request.params);
    const userId = request.user.sub;
    const org = await ensureOrgOwnership(userId, organizationId);

    const part = await request.file();
    if (!part) throw Errors.validation("Файл не загружен");

    const buffer = await part.toBuffer();
    const saved = await saveOrgAsset({
      userId,
      organizationId,
      kind: kind as AssetKind,
      filename: part.filename,
      mimeType: part.mimetype,
      buffer,
    });

    // Удаляем предыдущий файл, если был
    const previous = org[kind as "logo" | "stamp" | "signature"];
    if (previous) await deleteAsset(userId, previous);

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: { [kind]: saved.relativePath },
    });
    return reply.code(201).send({
      kind,
      path: saved.relativePath,
      url: `/api/v1/files/${saved.relativePath}`,
      size: saved.size,
      mimeType: saved.mimeType,
      organization: { id: updated.id, [kind]: saved.relativePath },
    });
  });

  // DELETE /api/v1/files/organizations/:orgId/:kind — удаляем файл и обнуляем поле
  app.delete("/organizations/:organizationId/:kind", async (request) => {
    const { organizationId, kind } = z
      .object({ organizationId: z.string().uuid(), kind: kindSchema })
      .parse(request.params);
    const userId = request.user.sub;
    const org = await ensureOrgOwnership(userId, organizationId);

    const previous = org[kind as "logo" | "stamp" | "signature"];
    if (previous) await deleteAsset(userId, previous);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { [kind]: null },
    });
    return { ok: true };
  });

  // GET /api/v1/files/* — отдаёт бинарник, если файл принадлежит текущему пользователю.
  // Путь — относительный (<userId>/<orgId>/<filename>).
  app.get("/*", async (request, reply) => {
    const userId = request.user.sub;
    // Fastify wildcard кладёт остаток в params["*"]
    const wild = (request.params as { "*"?: string })["*"];
    if (!wild) throw Errors.notFound("Файл");
    const relativePath = wild.replace(/^\/+/, "");
    // Дополнительная проверка: файл должен начинаться с userId/
    if (!relativePath.startsWith(`${userId}/`)) {
      throw Errors.forbidden("Доступ к чужим файлам запрещён");
    }
    const data = await readAsset(userId, relativePath);
    if (!data) throw Errors.notFound("Файл");
    reply.header("Content-Type", mimeTypeFor(relativePath));
    reply.header("Cache-Control", "private, max-age=60");
    return reply.send(data);
  });
}
