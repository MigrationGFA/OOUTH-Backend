import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import type { Env } from "../config/env";
import { accessCookieName, issueSession, readAccessToken, refreshCookieName } from "../lib/auth";
import { asyncHandler, pageQuery, paged, sendData, type AuthedRequest } from "../lib/http";
import { unauthorized } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { publicNotification } from "../lib/present";
import { createAppointmentService } from "../services/appointments.service";
import { createAuthService } from "../services/auth.service";
import { createEncounterService } from "../services/encounters.service";
import { createOperationsService } from "../services/operations.service";
import { createPaymentService } from "../services/payments.service";
import { createWorkspaceService } from "../services/workspace.service";
import type { JobQueue, Mailer, ObjectStorage, PaystackClient } from "../providers";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 400_000 } });

export function createRouter(env: Env, mailer: Mailer, storage: ObjectStorage, paystack: PaystackClient, _queue: JobQueue) {
  const router = Router();
  const auth = createAuthService(prisma, env, mailer);
  const appointments = createAppointmentService(prisma, env);
  const payments = createPaymentService(prisma, env, paystack);
  const encounters = createEncounterService(prisma, mailer, storage);
  const operations = createOperationsService(prisma);
  const workspace = createWorkspaceService(prisma);
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  router.get("/health", (_req, res) => sendData(res, { ok: true }));

  router.post("/auth/register", limit, asyncHandler(async (req, res) => sendData(res, await auth.register(req.body, res), 201)));
  router.post("/auth/login", limit, asyncHandler(async (req, res) => sendData(res, await auth.login(req.body, res))));
  router.post("/auth/logout", asyncHandler(async (req, res) => {
    const actor = await optionalActor(req, env);
    await auth.logout(actor?.id, req.cookies?.[refreshCookieName()], res);
    res.status(204).end();
  }));
  router.post("/auth/refresh", asyncHandler(async (req, res) => sendData(res, await auth.refresh(req.cookies?.[refreshCookieName()], res))));
  router.post("/auth/password-reset", limit, asyncHandler(async (req, res) => sendData(res, await auth.requestReset(req.body), 202)));
  router.post("/auth/password-reset/confirm", asyncHandler(async (req, res) => sendData(res, await auth.confirmReset(req.body))));
  router.get("/auth/me", protect(env), asyncHandler(async (req, res) => sendData(res, await auth.me(req.actor!.id))));
  router.post("/auth/change-password", protect(env), asyncHandler(async (req, res) => sendData(res, await auth.changePassword(req.actor!.id, req.body))));

  router.get("/patients/me", protect(env), asyncHandler(async (req, res) => sendData(res, await auth.me(req.actor!.id))));
  router.patch("/patients/me", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.profile(req.actor!.id, req.body))));
  router.get("/patients/:id/records", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.patientRecords(req.actor!.id, req.params.id))));
  router.post("/patients/:id/allergies", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.addAllergy(req.actor!.id, req.params.id, req.body), 201)));
  router.get("/patients/:id/allergies", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.listAllergies(req.actor!.id, req.params.id))));

  router.get("/departments", asyncHandler(async (req, res) => {
    const paging = pageQuery({ page: String(req.query.page ?? ""), pageSize: String(req.query.pageSize ?? "100") });
    const rows = await operations.departments({ group: stringQuery(req.query.group), booking: stringQuery(req.query.booking) });
    sendData(res, paged(rows.slice(paging.skip, paging.skip + paging.pageSize), rows.length, paging.page, paging.pageSize));
  }));
  router.get("/departments/:slug/slots", asyncHandler(async (req, res) => {
    const visit = req.query.type === "physical" ? "physical" : "virtual";
    sendData(res, await appointments.slots(req.params.slug, String(req.query.date ?? ""), visit));
  }));
  router.get("/consultants", asyncHandler(async (req, res) => sendData(res, await operations.consultants({ department: stringQuery(req.query.department), booking: stringQuery(req.query.booking) }))));
  router.get("/consultants/:slug", asyncHandler(async (req, res) => sendData(res, await operations.consultant(req.params.slug))));
  router.put("/consultants/:slug/availability", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.availability(req.actor!.id, req.params.slug, req.body))));

  router.post("/appointments", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.create(req.actor!.id, req.body), 201)));
  router.get("/appointments", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.list(req.actor!.id, { status: stringQuery(req.query.status), date: stringQuery(req.query.date), page: stringQuery(req.query.page), pageSize: stringQuery(req.query.pageSize) }))));
  router.get("/appointments/:id", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.get(req.actor!.id, req.params.id))));
  router.post("/appointments/:id/cancel", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.cancel(req.actor!.id, req.params.id, req.body))));
  router.post("/appointments/:id/reschedule", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.reschedule(req.actor!.id, req.params.id, req.body))));
  router.post("/appointments/:id/status", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.setStatus(req.actor!.id, req.params.id, req.body))));
  router.post("/appointments/:id/direct", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.direct(req.actor!.id, req.params.id, req.body))));
  router.post("/appointments/:id/triage", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.triage(req.actor!.id, req.params.id, req.body))));
  router.post("/appointments/:id/presence", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.presence(req.actor!.id, req.params.id, req.body))));
  router.post("/appointments/:id/video-token", protect(env), asyncHandler(async (req, res) => sendData(res, await appointments.videoToken(req.actor!.id, req.params.id))));
  router.put("/appointments/:id/record", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.saveRecord(req.actor!.id, req.params.id, req.body))));
  router.patch("/appointments/:id/encounter", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.patchDraft(req.actor!.id, req.params.id, req.body))));
  router.post("/appointments/:id/encounter/sign", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.sign(req.actor!.id, req.params.id, req.body))));
  router.get("/appointments/:id/encounter", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.read(req.actor!.id, req.params.id))));
  router.get("/appointments/:id/consultation-report", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.report(req.actor!.id, req.params.id))));

  router.post("/payments/initialize", protect(env), asyncHandler(async (req, res) => sendData(res, await payments.initialize(req.actor!.id, req.body))));
  router.post("/payments/verify", protect(env), asyncHandler(async (req, res) => sendData(res, await payments.verify(req.actor!.id, req.body))));
  router.post("/payments/webhook", asyncHandler(async (req, res) => sendData(res, await payments.webhook(req.body as Buffer, req.header("x-paystack-signature")))));

  router.post("/documents", protect(env), upload.single("file"), asyncHandler(async (req, res) => sendData(res, await encounters.upload(req.actor!.id, req.file, { appointmentId: String(req.body.appointmentId ?? ""), sharedWithPatient: String(req.body.sharedWithPatient ?? "") }), 201)));
  router.get("/documents", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.listDocuments(req.actor!.id))));
  router.get("/catalog/:kind", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.catalog(req.params.kind as "medications", req.actor!.id))));
  router.get("/encounters/:id/handoff", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.handoff(req.actor!.id, req.params.id, String(req.query.audience ?? "")))));
  router.post("/encounters/:id/demo-email", protect(env), asyncHandler(async (req, res) => sendData(res, await encounters.demoEmail(req.actor!.id, req.params.id))));
  router.post("/encounters/:appointmentId/operations", protect(env), asyncHandler(async (req, res) => sendData(res, { ok: true, message: "Pharmacy lines and investigation orders are created when the consultation is signed." })));

  router.get("/notifications", protect(env), asyncHandler(async (req, res) => sendData(res, (await operations.listNotifications(req.actor!.id)).map(publicNotification))));
  router.post("/notifications/:id/read", protect(env), asyncHandler(async (req, res) => sendData(res, publicNotification(await operations.readNotification(req.actor!.id, req.params.id)))));
  router.get("/dashboards/:role/summary", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.dashboard(req.actor!.id, req.params.role))));
  router.get("/session/workspace", protect(env), asyncHandler(async (req, res) => sendData(res, await workspace.snapshot(req.actor!.id))));

  router.post("/desk/patients", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.registerDeskPatient(req.actor!.id, req.body), 201)));
  router.patch("/desk/patients/:id", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.updateDeskPatient(req.actor!.id, req.params.id, req.body))));
  router.post("/desk/visits", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.createVisit(req.actor!.id, req.body), 201)));
  router.post("/desk/patients/:id/payments", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.deskPayment(req.actor!.id, req.params.id, req.body))));
  router.post("/desk/appointments/:id/check-in", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.checkIn(req.actor!.id, req.params.id, req.body))));
  router.post("/desk/appointments/:id/status", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.deskStatus(req.actor!.id, req.params.id, req.body))));
  router.post("/desk/requests/:id/collect", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.collect(req.actor!.id, req.params.id, req.body))));
  router.post("/desk/journeys/:id/status", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.setQueue(req.actor!.id, req.params.id, req.body))));
  router.get("/desk/journeys", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.lists(req.actor!.id,  "journeys"))));
  router.get("/desk/payments", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.lists(req.actor!.id,  "deskPayments"))));

  router.get("/pharmacy/dispenses", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.lists(req.actor!.id,  "dispenses"))));
  router.post("/pharmacy/dispenses/:id", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.dispense(req.actor!.id, req.params.id, req.body))));
  router.get("/pharmacy/inventory", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.lists(req.actor!.id,  "inventory"))));
  router.post("/pharmacy/inventory", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.saveInventory(req.actor!.id, req.body), 201)));

  router.get("/diagnostics/orders", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.lists(req.actor!.id,  "orders"))));
  router.post("/diagnostics/orders/:id", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.diagnostic(req.actor!.id, req.params.id, req.body))));

  router.post("/nursing/administrations", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.administer(req.actor!.id, req.body), 201)));
  router.post("/nursing/observation-orders", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.observationOrder(req.actor!.id, req.body), 201)));
  router.post("/nursing/observations", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.observation(req.actor!.id, req.body), 201)));
  router.post("/nursing/handovers", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.handover(req.actor!.id, req.body))));
  router.post("/nursing/handovers/:id/acknowledge", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.acknowledgeHandover(req.actor!.id, req.params.id))));
  router.post("/nursing/shifts", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.startShift(req.actor!.id, req.body), 201)));
  router.post("/nursing/shifts/:id/end", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.endShift(req.actor!.id, req.params.id))));
  router.post("/nursing/beds/:id/assign", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.assignBed(req.actor!.id, req.params.id, req.body))));
  router.post("/nursing/admissions", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.admit(req.actor!.id, req.body), 201)));
  router.post("/nursing/admissions/:id/status", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.admissionStatus(req.actor!.id, req.params.id, req.body))));
  router.post("/nursing/tasks", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.saveTask(req.actor!.id, req.body))));
  router.get("/nursing/:kind", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.lists(req.actor!.id, req.params.kind))));

  router.post("/ratings", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.rate(req.actor!.id, req.body), 201)));
  router.get("/ratings", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.lists(req.actor!.id,  "ratings"))));
  router.patch("/admin/ratings/:id", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.moderateRating(req.actor!.id, req.params.id, req.body))));
  router.patch("/admin/fees", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.updateFees(req.actor!.id, req.body))));
  router.get("/admin/fees", protect(env), asyncHandler(async (req, res) => {
    sendData(res, await operations.fees(req.actor!.id));
  }));
  router.patch("/admin/policies", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.updatePolicies(req.actor!.id, req.body))));
  router.post("/admin/staff", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.saveStaff(req.actor!.id, req.body), 201)));
  router.patch("/admin/consultants/:slug", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.setBooking(req.actor!.id, req.params.slug, req.body))));
  router.post("/admin/staff/:id/session", protect(env), asyncHandler(async (req, res) => {
    const target = await operations.openStaff(req.actor!.id, req.params.id);
    await issueSession(prisma, env, res, target.id, target.role, target.email);
    sendData(res, { role: target.role, userId: target.id });
  }));
  router.post("/admin/registration", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.settleRegistration(req.actor!.id, req.body))));
  router.post("/admin/departments", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.saveOperationalDepartment(req.actor!.id, req.body), 201)));
  router.post("/admin/staff/department", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.assignStaffDepartment(req.actor!.id, req.body))));
  router.post("/admin/demo/reset", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.resetDemo(req.actor!.id))));
  router.post("/nursing/allergies/:patientId/none", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.confirmNoAllergies(req.actor!.id, req.params.patientId))));
  router.post("/nursing/clarifications", protect(env), asyncHandler(async (req, res) => sendData(res, await operations.flagClarification(req.actor!.id, req.body), 201)));

  return router;
}

function protect(env: Env) {
  return asyncHandler(async (req, _res, next) => {
    const token = req.cookies?.[accessCookieName()] || headerToken(req.header("authorization"));
    const payload = token ? readAccessToken(env, token) : null;
    if (!payload) throw unauthorized();
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || !user.active || user.deletedAt) throw unauthorized();
    req.actor = {
      id: user.id,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      consultantSlug: user.consultantSlug,
      staffId: user.staffId,
      patientNumber: user.patientNumber,
      active: user.active,
      registrationPaidYear: user.registrationPaidYear,
    };
    next();
  });
}

async function optionalActor(req: AuthedRequest, env: Env) {
  const token = req.cookies?.[accessCookieName()];
  const payload = token ? readAccessToken(env, token) : null;
  return payload;
}

function headerToken(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return "";
  return value.slice(7);
}

function stringQuery(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
