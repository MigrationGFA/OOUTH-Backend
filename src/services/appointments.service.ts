import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../config/env";
import { nextCounter, notifyUser, reference, writeAudit } from "../lib/audit";
import { signVideoToken } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { publicAppointment } from "../lib/present";
import { calculateFees, hoursUntil, lagosCalendarYear, lagosDayKey, planReschedule, registrationIsDue, slotsForDate } from "../domain/scheduling";
import { assertRole, availabilityFor, canSeeAppointment, requireUser, settings, slotKey, SUPER_CONSULTANT_SLUG, takenStarts, DEMO_CONSULTANT_SLUGS } from "./shared";

const bookingSchema = z.object({
  departmentSlug: z.string().optional().default(""),
  consultationType: z.enum(["physical", "virtual"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  reason: z.string().trim().min(3),
  symptoms: z.string().optional().default(""),
  medicalHistory: z.string().optional().default(""),
  history: z.string().optional(),
  privacyConsent: z.boolean(),
  telemedicineConsent: z.boolean().optional().default(false),
});

export function createAppointmentService(prisma: PrismaClient, env: Env) {
  return {
    async slots(departmentSlug: string, date: string, visit: "physical" | "virtual") {
      if (departmentSlug) {
        const department = await prisma.department.findUnique({ where: { slug: departmentSlug } });
        if (!department || department.deletedAt) throw notFound("That department was not found.");
      }
      const availability = await availabilityFor(prisma, SUPER_CONSULTANT_SLUG);
      if (visit === "physical" && !availability.physicalEnabled) return [];
      if (visit === "virtual" && !availability.virtualEnabled) return [];
      const consultant = await prisma.user.findFirst({ where: { consultantSlug: SUPER_CONSULTANT_SLUG, role: "consultant" } });
      if (consultant && !consultant.onlineBookingEnabled) return [];
      return slotsForDate(date, availability, await takenStarts(prisma, SUPER_CONSULTANT_SLUG));
    },

    async create(userId: string, body: unknown) {
      const input = bookingSchema.parse(body);
      const user = await requireUser(prisma, userId);
      assertRole(user, ["patient"]);
      if (!input.privacyConsent) throw badRequest("Privacy consent is required.");
      if (input.consultationType === "virtual" && !input.telemedicineConsent) throw badRequest("Telemedicine consent is required for a virtual visit.");
      if (input.departmentSlug) {
        const department = await prisma.department.findUnique({ where: { slug: input.departmentSlug } });
        if (!department || !department.patientBooking) throw forbidden("That service is not open for online booking.");
      }
      const consultant = await prisma.user.findFirst({ where: { consultantSlug: SUPER_CONSULTANT_SLUG, role: "consultant", active: true } });
      if (!consultant?.onlineBookingEnabled) throw forbidden("Online booking is not open.");
      const availability = await availabilityFor(prisma, SUPER_CONSULTANT_SLUG);
      const starts = new Date(input.startsAt);
      const date = lagosDayKey(starts.toISOString());
      const open = slotsForDate(date, availability, await takenStarts(prisma, SUPER_CONSULTANT_SLUG));
      const slot = open.find((item) => item.startsAt === starts.toISOString());
      if (!slot) throw conflict("That time is no longer available.");
      const hospital = await settings(prisma);
      const fees = calculateFees(
        { consultationPerHourNaira: hospital.consultationPerHourNaira, registrationFeeNaira: hospital.registrationFeeNaira, defaultDurationMinutes: hospital.defaultDurationMinutes },
        availability.durationMinutes,
        registrationIsDue(user.registrationPaidYear),
      );
      const year = lagosCalendarYear();
      const appointment = await prisma.$transaction(async (tx) => {
        const seq = await nextCounter(tx, `apt-${year}`);
        const created = await tx.appointment.create({
          data: {
            reference: reference("OOUTH-APT", year, seq),
            patientUserId: user.id,
            consultantSlug: SUPER_CONSULTANT_SLUG,
            departmentSlug: input.departmentSlug,
            consultationType: input.consultationType,
            startsAt: new Date(slot.startsAt),
            endsAt: new Date(slot.endsAt),
            reason: input.reason,
            symptoms: input.symptoms || "",
            medicalHistory: input.medicalHistory || input.history || "",
            status: "pending_payment",
            paymentStatus: "pending_verification",
            amountNaira: fees.totalNaira,
            consultationFeeNaira: fees.consultationNaira,
            registrationFeeNaira: fees.registrationNaira,
            durationMinutes: fees.durationMinutes,
            privacyConsent: true,
            telemedicineConsent: input.telemedicineConsent,
            suggestedDepartmentSlugs: [],
            bookingSource: "online",
            slotKey: slotKey(SUPER_CONSULTANT_SLUG, new Date(slot.startsAt)),
          },
        });
        await writeAudit(tx, user.id, "appointment.create", `Created ${created.reference}`, { type: "appointment", id: created.id });
        await notifyUser(tx, user.id, "Appointment ready for payment", `${created.reference} is not confirmed until payment is verified.`, `/patient/appointments/${created.id}`);
        return created;
      });
      return publicAppointment(appointment);
    },

    async list(userId: string, query: { status?: string; date?: string; page?: string; pageSize?: string }) {
      const user = await requireUser(prisma, userId);
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
      const where = appointmentWhere(user, query.status, query.date);
      const [items, total] = await Promise.all([
        prisma.appointment.findMany({ where, orderBy: { startsAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.appointment.count({ where }),
      ]);
      return { items: items.map((item) => presentFor(user, item)), page, pageSize, total };
    },

    async get(userId: string, id: string) {
      const user = await requireUser(prisma, userId);
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment || !canSeeAppointment(user, appointment)) throw notFound("That appointment was not found.");
      return presentFor(user, appointment);
    },

    async cancel(userId: string, id: string, body: unknown) {
      const input = z.object({ reason: z.string().trim().min(2) }).parse(body);
      const user = await requireUser(prisma, userId);
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment || !canSeeAppointment(user, appointment)) throw notFound("That appointment was not found.");
      const allowed = user.role === "administrator" || user.id === appointment.patientUserId || (user.role === "consultant" && (user.consultantSlug === appointment.consultantSlug || user.consultantSlug === SUPER_CONSULTANT_SLUG));
      if (!allowed) throw forbidden("You cannot cancel this visit.");
      if (appointment.status === "cancelled") return publicAppointment(appointment);
      const hospital = await settings(prisma);
      if (appointment.paymentStatus === "verified" && hoursUntil(appointment.startsAt.toISOString()) < hospital.cancellationNoticeHours && user.role === "patient") {
        throw conflict(`Cancellation closes ${hospital.cancellationNoticeHours} hours before the visit.`);
      }
      const updated = await prisma.appointment.update({
        where: { id },
        data: { status: "cancelled", cancelReason: input.reason, slotKey: null, pendingSlotKey: null },
      });
      await writeAudit(prisma, user.id, "appointment.cancel", `Cancelled ${appointment.reference}: ${input.reason}`, { type: "appointment", id });
      return publicAppointment(updated);
    },

    async reschedule(userId: string, id: string, body: unknown) {
      const input = z.object({ startsAt: z.string().datetime() }).parse(body);
      const user = await requireUser(prisma, userId);
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment || !canSeeAppointment(user, appointment)) throw notFound("That appointment was not found.");
      const isConsultant = user.role === "consultant" && (user.consultantSlug === appointment.consultantSlug || user.consultantSlug === SUPER_CONSULTANT_SLUG);
      if (user.role !== "patient" && !isConsultant) throw forbidden("You cannot move this visit.");
      if (user.role === "patient" && user.id !== appointment.patientUserId) throw forbidden("You cannot move this visit.");
      const hospital = await settings(prisma);
      const availability = await availabilityFor(prisma, appointment.consultantSlug);
      const starts = new Date(input.startsAt);
      const open = slotsForDate(lagosDayKey(starts.toISOString()), availability, await takenStarts(prisma, appointment.consultantSlug, appointment.id));
      const slot = open.find((item) => item.startsAt === starts.toISOString());
      const plan = planReschedule({
        role: user.role === "consultant" ? "consultant" : "patient",
        paymentStatus: appointment.paymentStatus,
        slotOpen: Boolean(slot),
        noticeOpen: hoursUntil(appointment.startsAt.toISOString()) >= hospital.rescheduleNoticeHours,
        noticeHours: hospital.rescheduleNoticeHours,
        consultationFeeNaira: appointment.consultationFeeNaira,
        startsAt: slot?.startsAt ?? input.startsAt,
        endsAt: slot?.endsAt ?? input.startsAt,
      });
      if (!plan.ok) throw conflict(plan.error);
      const updated = await prisma.appointment.update({
        where: { id },
        data: plan.mode === "apply"
          ? { startsAt: new Date(plan.startsAt), endsAt: new Date(plan.endsAt), pendingStartsAt: null, pendingEndsAt: null, rescheduleFeeNaira: 0, pendingSlotKey: null, slotKey: slotKey(appointment.consultantSlug, new Date(plan.startsAt)) }
          : { pendingStartsAt: new Date(plan.startsAt), pendingEndsAt: new Date(plan.endsAt), rescheduleFeeNaira: plan.feeNaira, pendingSlotKey: slotKey(appointment.consultantSlug, new Date(plan.startsAt)) },
      });
      await writeAudit(prisma, user.id, "appointment.reschedule", `Rescheduled ${appointment.reference}`, { type: "appointment", id });
      return { ...publicAppointment(updated), pending: plan.mode === "pending_fee", feeNaira: plan.feeNaira };
    },

    async setStatus(userId: string, id: string, body: unknown) {
      const input = z.object({ status: z.enum(["in_progress", "completed", "no_show"]) }).parse(body);
      const user = await requireUser(prisma, userId);
      assertRole(user, ["consultant"]);
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment) throw notFound("That appointment was not found.");
      if (user.consultantSlug !== appointment.consultantSlug && user.consultantSlug !== SUPER_CONSULTANT_SLUG) throw forbidden("This visit is not assigned to you.");
      if (appointment.paymentStatus !== "verified") throw conflict("Payment has not been verified.");
      const updated = await prisma.appointment.update({ where: { id }, data: { status: input.status, slotKey: input.status === "no_show" ? null : appointment.slotKey } });
      await writeAudit(prisma, user.id, "appointment.status", `Marked ${appointment.reference} ${input.status}`, { type: "appointment", id });
      return publicAppointment(updated);
    },

    async direct(userId: string, id: string, body: unknown) {
      const input = z.object({ consultantSlug: z.string() }).parse(body);
      const user = await requireUser(prisma, userId);
      if (user.consultantSlug !== SUPER_CONSULTANT_SLUG) throw forbidden("Only the first consultant can direct this visit.");
      if (!DEMO_CONSULTANT_SLUGS.includes(input.consultantSlug)) throw badRequest("Choose one of the two demonstration consultants.");
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment) throw notFound("That appointment was not found.");
      if (["in_progress", "completed", "cancelled"].includes(appointment.status)) throw conflict("This visit can no longer be directed.");
      const target = await prisma.user.findFirst({ where: { consultantSlug: input.consultantSlug, role: "consultant" } });
      if (!target) throw badRequest("That consultant is not available.");
      const updated = await prisma.appointment.update({
        where: { id },
        data: { consultantSlug: input.consultantSlug, slotKey: slotKey(input.consultantSlug, appointment.startsAt) },
      });
      await notifyUser(prisma, target.id, "A visit was directed to you", `${appointment.reference} is now on your list.`, `/consultant/appointments/${appointment.id}`);
      await writeAudit(prisma, user.id, "appointment.direct", `Directed ${appointment.reference} to ${input.consultantSlug}`, { type: "appointment", id });
      return publicAppointment(updated);
    },

    async presence(userId: string, id: string, body: unknown) {
      const input = z.object({ present: z.boolean() }).parse(body);
      const user = await requireUser(prisma, userId);
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment || !canSeeAppointment(user, appointment)) throw notFound("That appointment was not found.");
      const data = user.role === "patient" ? { patientInRoom: input.present } : user.role === "consultant" ? { consultantInRoom: input.present } : null;
      if (!data) throw forbidden("Only the patient or consultant can update the room.");
      const updated = await prisma.appointment.update({ where: { id }, data });
      return publicAppointment(updated);
    },

    async videoToken(userId: string, id: string) {
      const user = await requireUser(prisma, userId);
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment) throw notFound("That appointment was not found.");
      const owns = user.id === appointment.patientUserId || (user.role === "consultant" && (user.consultantSlug === appointment.consultantSlug || user.consultantSlug === SUPER_CONSULTANT_SLUG));
      if (!owns) throw forbidden("You cannot join this visit.");
      if (appointment.consultationType !== "virtual" || appointment.paymentStatus !== "verified" || appointment.status === "cancelled") {
        throw forbidden("This video room is not open.");
      }
      const hospital = await settings(prisma);
      const start = appointment.startsAt.getTime() - hospital.joinMinutesBefore * 60_000;
      const end = appointment.endsAt.getTime() + hospital.joinMinutesAfter * 60_000;
      const now = Date.now();
      if (now < start || now > end) throw forbidden("The join window is closed.");
      const expiresAt = new Date(Math.min(end, now + 15 * 60_000));
      return { token: signVideoToken(env, { appointmentId: id, userId: user.id, expiresAt }), expiresAt: expiresAt.toISOString(), recording: false };
    },

    async triage(userId: string, id: string, body: unknown) {
      const input = z.object({
        departmentSlug: z.string().min(1),
        consultantSlug: z.string().min(1),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
      }).parse(body);
      const user = await requireUser(prisma, userId);
      if (user.role !== "desk_officer" && user.role !== "administrator" && user.consultantSlug !== SUPER_CONSULTANT_SLUG) {
        throw forbidden("You cannot assign this visit.");
      }
      const appointment = await prisma.appointment.findUnique({ where: { id } });
      if (!appointment) throw notFound("That appointment was not found.");
      const starts = new Date(input.startsAt);
      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          departmentSlug: input.departmentSlug,
          consultantSlug: input.consultantSlug,
          startsAt: starts,
          endsAt: new Date(input.endsAt),
          status: appointment.paymentStatus === "verified" ? "confirmed" : "pending_payment",
          slotKey: slotKey(input.consultantSlug, starts),
        },
      });
      await writeAudit(prisma, user.id, "appointment.triage", `Assigned ${appointment.reference}`, { type: "appointment", id });
      return publicAppointment(updated);
    },
  };
}

function appointmentWhere(user: { id: string; role: string; consultantSlug: string | null }, status?: string, date?: string) {
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (date) {
    const start = new Date(`${date}T00:00:00+01:00`);
    filter.startsAt = { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
  }
  if (user.role === "patient") filter.patientUserId = user.id;
  else if (user.role === "consultant" && user.consultantSlug !== SUPER_CONSULTANT_SLUG) filter.consultantSlug = user.consultantSlug;
  else if (!["administrator", "desk_officer", "consultant", "nurse", "pharmacist", "laboratory_officer"].includes(user.role)) filter.patientUserId = user.id;
  return filter;
}

function presentFor(user: { role: string }, appointment: Parameters<typeof publicAppointment>[0]) {
  const view = publicAppointment(appointment);
  if (user.role === "administrator") return { ...view, medicalHistory: "", symptoms: view.symptoms ? "Recorded" : "" };
  return view;
}
