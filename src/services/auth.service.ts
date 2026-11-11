import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../config/env";
import { nextCounter, notifyUser, reference, writeAudit } from "../lib/audit";
import { clearSessionCookies, hashPassword, hashToken, issueSession, randomToken, rotateRefresh, verifyPassword } from "../lib/auth";
import { badRequest, conflict, unauthorized } from "../lib/errors";
import { publicUser } from "../lib/present";
import { lagosCalendarYear } from "../domain/scheduling";
import type { Mailer } from "../providers";
import type { Response } from "express";

const registerSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  dateOfBirth: z.string().trim().min(4),
  gender: z.enum(["female", "male", "unspecified"]),
  address: z.string().trim().min(3),
  password: z.string().min(8),
});

const SAME_LOGIN_ERROR = "Email or password is not recognised.";

export function createAuthService(prisma: PrismaClient, env: Env, mailer: Mailer) {
  return {
    async register(body: unknown, res: Response) {
      const input = registerSchema.parse(body);
      const email = input.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw conflict("That email is already registered.");
      const year = lagosCalendarYear();
      const user = await prisma.$transaction(async (tx) => {
        const seq = await nextCounter(tx, `patient-${year}`);
        const created = await tx.user.create({
          data: {
            role: "patient",
            firstName: input.firstName,
            lastName: input.lastName,
            email,
            phone: input.phone,
            dateOfBirth: input.dateOfBirth,
            gender: input.gender,
            address: input.address,
            passwordHash: await hashPassword(input.password),
            patientNumber: reference("OOUTH-P", year, seq),
            registrationPaidYear: null,
          },
        });
        await writeAudit(tx, created.id, "patient.register", `Registered ${created.patientNumber}`, { type: "user", id: created.id });
        await notifyUser(tx, created.id, "Account created", `Your patient number is ${created.patientNumber}.`, "/patient/dashboard");
        return created;
      });
      await issueSession(prisma, env, res, user.id, user.role, user.email);
      return { id: user.id, patientNumber: user.patientNumber, user: publicUser(user) };
    },

    async login(body: unknown, res: Response) {
      const input = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).parse(body);
      const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user || user.deletedAt || !user.active || !(await verifyPassword(user.passwordHash, input.password))) {
        throw unauthorized(SAME_LOGIN_ERROR);
      }
      await issueSession(prisma, env, res, user.id, user.role, user.email);
      await writeAudit(prisma, user.id, "auth.sign-in", "Signed in");
      return { user: publicUser(user) };
    },

    async logout(userId: string | undefined, rawRefresh: string | undefined, res: Response) {
      if (rawRefresh) {
        await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawRefresh), revokedAt: null }, data: { revokedAt: new Date() } });
      }
      if (userId) await writeAudit(prisma, userId, "auth.sign-out", "Session closed");
      clearSessionCookies(res, env);
    },

    async refresh(rawRefresh: string | undefined, res: Response) {
      if (!rawRefresh) throw unauthorized();
      const user = await rotateRefresh(prisma, env, res, rawRefresh);
      return { user: publicUser(user) };
    },

    async me(userId: string) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.deletedAt) throw unauthorized();
      return publicUser(user);
    },

    async changePassword(userId: string, body: unknown) {
      const input = z.object({ currentPassword: z.string().min(1), nextPassword: z.string().min(8) }).parse(body);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw unauthorized();
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw badRequest("The current password is not correct.");
      await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.nextPassword) } });
      await writeAudit(prisma, userId, "auth.password", "Changed password");
      return { ok: true };
    },

    async requestReset(body: unknown) {
      const input = z.object({ email: z.string().trim().email() }).parse(body);
      const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (user && user.active && !user.deletedAt) {
        const token = randomToken();
        await prisma.passwordReset.create({
          data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        });
        await mailer.send({
          to: user.email,
          subject: "Reset your OOUTH password",
          text: `Use this reset token within one hour: ${token}`,
        });
        await writeAudit(prisma, user.id, "auth.password-reset", "Password reset requested");
      }
      return { accepted: true };
    },

    async confirmReset(body: unknown) {
      const input = z.object({ token: z.string().min(10), password: z.string().min(8) }).parse(body);
      const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(input.token) } });
      if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw badRequest("That reset link is no longer valid.");
      await prisma.$transaction([
        prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(input.password) } }),
        prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
        prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await writeAudit(prisma, row.userId, "auth.password-reset", "Password reset completed");
      return { ok: true };
    },
  };
}
