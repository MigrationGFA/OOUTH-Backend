import { createHash, randomBytes, createHmac } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { Response } from "express";
import type { Env } from "../config/env";
import type { PrismaClient } from "@prisma/client";
import { unauthorized } from "./errors";

const ACCESS_COOKIE = "oouth_access";
const REFRESH_COOKIE = "oouth_refresh";

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

type TokenUser = { id: string; role: string; email: string };

export function signAccessToken(env: Env, user: TokenUser) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_MINUTES}m`,
  });
}

export function readAccessToken(env: Env, token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.sub !== "string") return null;
    return { id: payload.sub, role: String(payload.role ?? ""), email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}

export function cookieBase(env: Env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export function setSessionCookies(res: Response, env: Env, accessToken: string, refreshToken: string) {
  const base = cookieBase(env);
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, maxAge: env.ACCESS_TOKEN_MINUTES * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookies(res: Response, env: Env) {
  const base = cookieBase(env);
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

export function accessCookieName() {
  return ACCESS_COOKIE;
}

export function refreshCookieName() {
  return REFRESH_COOKIE;
}

export async function issueSession(prisma: PrismaClient, env: Env, res: Response, userId: string, role: string, email: string) {
  const accessToken = signAccessToken(env, { id: userId, role, email });
  const refreshToken = randomToken();
  const familyId = randomBytes(16).toString("hex");
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  setSessionCookies(res, env, accessToken, refreshToken);
}

export async function rotateRefresh(prisma: PrismaClient, env: Env, res: Response, rawToken: string) {
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!current || current.revokedAt || current.expiresAt.getTime() < Date.now()) {
    throw unauthorized("Sign in to continue.");
  }
  const user = await prisma.user.findUnique({ where: { id: current.userId } });
  if (!user || !user.active || user.deletedAt) throw unauthorized("Sign in to continue.");
  const nextToken = randomToken();
  const created = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(nextToken),
      familyId: current.familyId,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.refreshToken.update({
    where: { id: current.id },
    data: { revokedAt: new Date(), replacedById: created.id },
  });
  const accessToken = signAccessToken(env, { id: user.id, role: user.role, email: user.email });
  setSessionCookies(res, env, accessToken, nextToken);
  return user;
}

export function signVideoToken(env: Env, input: { appointmentId: string; userId: string; expiresAt: Date }) {
  const payload = `${input.appointmentId}.${input.userId}.${input.expiresAt.toISOString()}`;
  const signature = createHmac("sha256", env.VIDEO_TOKEN_SECRET).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}
