import type { Prisma, PrismaClient } from "@prisma/client";

export async function writeAudit(
  prisma: PrismaClient | Prisma.TransactionClient,
  actorId: string,
  action: string,
  summary: string,
  entity?: { type?: string; id?: string },
) {
  await prisma.auditEvent.create({
    data: {
      actorId,
      action,
      summary,
      entityType: entity?.type,
      entityId: entity?.id,
    },
  });
}

export async function notifyUser(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  title: string,
  body: string,
  href?: string,
) {
  await prisma.notification.create({ data: { userId, title, body, href } });
}

export async function nextCounter(prisma: PrismaClient | Prisma.TransactionClient, key: string) {
  const row = await prisma.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

export function reference(prefix: string, year: number, value: number) {
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}
