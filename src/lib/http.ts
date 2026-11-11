import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "./errors";

export type AuthedRequest = Request & {
  actor?: {
    id: string;
    role: string;
    email: string;
    firstName: string;
    lastName: string;
    consultantSlug: string | null;
    staffId: string | null;
    patientNumber: string | null;
    active: boolean;
    registrationPaidYear: number | null;
  };
};

export function sendData(res: Response, data: unknown, status = 200) {
  res.status(status).json({ data });
}

export function asyncHandler(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => issue.message).join(" ");
    res.status(400).json({ error: { code: "validation_error", message: message || "Check the submitted fields." } });
    return;
  }
  const prismaCode = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
  if (prismaCode === "P2002") {
    res.status(409).json({ error: { code: "conflict", message: "That record already exists." } });
    return;
  }
  res.status(500).json({ error: { code: "server_error", message: "The hospital service could not complete that request." } });
}

export function pageQuery(input: { page?: string; pageSize?: string }) {
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total };
}
