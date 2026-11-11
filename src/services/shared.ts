import type { Prisma, PrismaClient, User } from "@prisma/client";
import { forbidden, notFound } from "../lib/errors";
import { defaultAvailability, isActiveStatus, type Availability } from "../domain/scheduling";
import { publicAvailability } from "../lib/present";
import type { AuthedRequest } from "../lib/http";

export const SUPER_CONSULTANT_SLUG = "super_consultant";
export const DEMO_CONSULTANT_SLUGS = ["demo-consultant-a", "demo-consultant-b"];

export async function requireUser(prisma: PrismaClient, actorId: string) {
  const user = await prisma.user.findUnique({ where: { id: actorId } });
  if (!user || !user.active || user.deletedAt) throw forbidden("This account cannot continue.");
  return user;
}

export function assertRole(user: User, roles: string[]) {
  if (!roles.includes(user.role)) throw forbidden("You cannot perform this action.");
}

export async function settings(prisma: PrismaClient) {
  const row = await prisma.hospitalSettings.findUnique({ where: { id: "default" } });
  if (!row) throw notFound("Hospital settings are not ready.");
  return row;
}

export async function availabilityFor(prisma: PrismaClient, slug: string): Promise<Availability> {
  const row = await prisma.availability.findUnique({ where: { consultantSlug: slug } });
  return row ? publicAvailability(row) : defaultAvailability(slug);
}

export async function takenStarts(prisma: PrismaClient | Prisma.TransactionClient, consultantSlug: string, ignoreId?: string) {
  const rows = await prisma.appointment.findMany({
    where: { consultantSlug, id: ignoreId ? { not: ignoreId } : undefined },
    select: { startsAt: true, status: true, pendingStartsAt: true },
  });
  const taken = new Set<string>();
  for (const row of rows) {
    if (isActiveStatus(row.status)) taken.add(row.startsAt.toISOString());
    if (row.pendingStartsAt && row.status !== "cancelled") taken.add(row.pendingStartsAt.toISOString());
  }
  return taken;
}

export function slotKey(consultantSlug: string, startsAt: Date) {
  return `${consultantSlug}|${startsAt.toISOString()}`;
}

export function actorFrom(req: AuthedRequest) {
  if (!req.actor) throw forbidden("Sign in to continue.");
  return req.actor;
}

export function canSeeAppointment(user: User, appointment: { patientUserId: string; consultantSlug: string }) {
  if (user.role === "administrator" || user.role === "desk_officer") return true;
  if (user.role === "patient") return appointment.patientUserId === user.id;
  if (user.role === "consultant") {
    if (user.consultantSlug === SUPER_CONSULTANT_SLUG) return true;
    return user.consultantSlug === appointment.consultantSlug;
  }
  return false;
}
