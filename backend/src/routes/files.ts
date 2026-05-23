// Эндпойнты для загрузки/удаления/получения изображений организации:
// логотип, печать, подпись. MVP — локальный диск backend/uploads/<userId>/...
// Все ручки требуют JWT. Sprint 9: upload/delete only ADMIN+, download for
// any ACTIVE member of the organization.

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
import { getAccessibleUserIds, requireOrgAccess } from "../lib/org-access.js";

const kindSchema = z.enum(["logo", "stamp", "signature"]);

export async function filesRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES } });

  app.addHook("onRequest", app.authenticate);

  // POST /api/v1/files/organizations/:orgId/:kind — multipart с одним файлом.
  app.post("/organizations/:organizationId/:kind", async (request, reply) => {
    const { organizationId, kind } = z
      .object({ organizationId: z.string().uuid(), kind: kindSchema })
      .parse(request.params);
    const userId = request.user.sub;
    await requireOrgAccess(prisma, userId, organizationId, "files:upload");
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw Errors.notFound("Организация");

    const part = await request.file();
    if (!part) throw Errors.validation("Файл не загружен");

    const buffer = await part.toBuffer();
    // Files live under the organization OWNER's userId so members can find
    // them via the same path the legacy code expects.
    const saved = await saveOrgAsset({
      userId: org.userId,
      organizationId,
      kind: kind as AssetKind,
      filename: part.filename,
      mimeType: part.mimetype,
      buffer,
    });

    const previous = org[kind as "logo" | "stamp" | "signature"];
    if (previous) await deleteAsset(org.userId, previous);

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

  app.delete("/organizations/:organizationId/:kind", async (request) => {
    const { organizationId, kind } = z
      .object({ organizationId: z.string().uuid(), kind: kindSchema })
      .parse(request.params);
    const userId = request.user.sub;
    await requireOrgAccess(prisma, userId, organizationId, "files:delete");
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw Errors.notFound("Организация");

    const previous = org[kind as "logo" | "stamp" | "signature"];
    if (previous) await deleteAsset(org.userId, previous);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { [kind]: null },
    });
    return { ok: true };
  });

  // GET /api/v1/files/* — отдаёт бинарник, если файл лежит у owner-а
  // организации, в которой вызывающий — ACTIVE member.
  app.get("/*", async (request, reply) => {
    const userId = request.user.sub;
    const wild = (request.params as { "*"?: string })["*"];
    if (!wild) throw Errors.notFound("Файл");
    const relativePath = wild.replace(/^\/+/, "");
    // Sprint 9: the path starts with the owner's userId. Verify the caller
    // is an active member of one of that owner's organizations.
    const accessibleUserIds = await getAccessibleUserIds(prisma, userId);
    const fileOwner = relativePath.split("/")[0];
    if (!fileOwner || !accessibleUserIds.includes(fileOwner)) {
      throw Errors.forbidden("Доступ к чужим файлам запрещён");
    }
    const data = await readAsset(fileOwner, relativePath);
    if (!data) throw Errors.notFound("Файл");
    reply.header("Content-Type", mimeTypeFor(relativePath));
    reply.header("Cache-Control", "private, max-age=60");
    return reply.send(data);
  });
}
