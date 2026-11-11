import { createHmac, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../config/env";
import { notifyUser, writeAudit } from "../lib/audit";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { publicAppointment } from "../lib/present";
import { lagosCalendarYear } from "../domain/scheduling";
import type { PaystackClient } from "../providers";
import { requireUser, slotKey } from "./shared";

export function createPaymentService(prisma: PrismaClient, env: Env, paystack: PaystackClient) {
  return {
    async initialize(userId: string, body: unknown) {
      const input = z.object({ appointmentId: z.string().uuid() }).parse(body);
      const user = await requireUser(prisma, userId);
      if (user.role !== "patient") throw forbidden("Only the patient can pay for this visit.");
      const appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId } });
      if (!appointment || appointment.patientUserId !== user.id) throw notFound("That appointment was not found.");
      if (appointment.status === "cancelled") throw conflict("This visit is cancelled.");
      const amountNaira = appointment.pendingStartsAt ? appointment.rescheduleFeeNaira : appointment.amountNaira;
      if (appointment.paymentStatus === "verified" && !appointment.pendingStartsAt) throw conflict("This visit is already paid.");
      if (!env.PAYSTACK_SECRET_KEY) throw new ApiError(503, "payment_unavailable", "Card payment is not configured yet.");
      const reference = `OOUTH-PAY-${randomBytes(6).toString("hex")}`;
      const purpose = appointment.pendingStartsAt ? "reschedule" : "visit";
      await prisma.payment.create({
        data: { appointmentId: appointment.id, patientUserId: user.id, reference, purpose, amountNaira, status: "pending" },
      });
      const started = await paystack.initialize({
        email: user.email,
        amountKobo: amountNaira * 100,
        reference,
        metadata: { appointmentId: appointment.id, purpose },
        callbackUrl: `${env.FRONTEND_ORIGIN}/patient/payments/return`,
      });
      await prisma.appointment.update({ where: { id: appointment.id }, data: { paymentReference: reference, paymentStatus: "pending_verification" } });
      await writeAudit(prisma, user.id, "payment.initialize", `Started ${reference} for ${appointment.reference}`, { type: "payment", id: reference });
      return { authorizationUrl: started.authorizationUrl, reference: started.reference, publicKey: env.PAYSTACK_PUBLIC_KEY };
    },

    async verify(userId: string | null, body: unknown) {
      const input = z.object({ reference: z.string().min(4) }).parse(body);
      return settle(prisma, paystack, input.reference, userId);
    },

    async webhook(rawBody: Buffer, signature: string | undefined) {
      if (!env.PAYSTACK_SECRET_KEY) throw new ApiError(503, "payment_unavailable", "Card payment is not configured yet.");
      const digest = createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
      if (!signature || signature !== digest) throw forbidden("The payment notification could not be verified.");
      const payload = JSON.parse(rawBody.toString("utf8")) as { event?: string; data?: { reference?: string } };
      if (payload.event !== "charge.success" || !payload.data?.reference) return { ignored: true };
      return settle(prisma, paystack, payload.data.reference, null);
    },
  };
}

async function settle(prisma: PrismaClient, paystack: PaystackClient, reference: string, userId: string | null) {
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) throw notFound("That payment was not found.");
  if (userId && payment.patientUserId !== userId) throw forbidden("You cannot confirm this payment.");
  if (payment.status === "verified") {
    const appointment = await prisma.appointment.findUnique({ where: { id: payment.appointmentId } });
    return { status: "verified", duplicate: true, appointment: appointment ? publicAppointment(appointment) : null };
  }
  let verified;
  try {
    verified = await paystack.verify(reference);
  } catch {
    throw new ApiError(402, "payment_failed", "The payment was not successful.");
  }
  if (verified.status !== "success" || verified.amountKobo !== payment.amountNaira * 100) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "failed" } });
    await prisma.appointment.update({ where: { id: payment.appointmentId }, data: { paymentStatus: "failed" } });
    throw new ApiError(402, "payment_failed", "The payment was not successful.");
  }
  const appointment = await prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUnique({ where: { id: payment.id } });
    if (!current) throw notFound("That payment was not found.");
    if (current.status === "verified") {
      const existing = await tx.appointment.findUnique({ where: { id: current.appointmentId } });
      if (!existing) throw notFound("That appointment was not found.");
      return existing;
    }
    await tx.payment.update({ where: { id: current.id }, data: { status: "verified", verifiedAt: new Date() } });
    const visit = await tx.appointment.findUnique({ where: { id: current.appointmentId } });
    if (!visit) throw notFound("That appointment was not found.");
    const applyingReschedule = current.purpose === "reschedule" && visit.pendingStartsAt && visit.pendingEndsAt;
    const data: Record<string, unknown> = { paymentStatus: "verified", paymentReference: reference };
    if (applyingReschedule && visit.pendingStartsAt && visit.pendingEndsAt) {
      data.startsAt = visit.pendingStartsAt;
      data.endsAt = visit.pendingEndsAt;
      data.slotKey = slotKey(visit.consultantSlug, visit.pendingStartsAt);
      data.pendingStartsAt = null;
      data.pendingEndsAt = null;
      data.pendingSlotKey = null;
      data.rescheduleFeeNaira = 0;
    } else if (visit.status === "pending_payment" || visit.status === "awaiting_triage") {
      data.status = visit.status === "awaiting_triage" ? "awaiting_triage" : "confirmed";
    }
    const updated = await tx.appointment.update({ where: { id: visit.id }, data });
    if (!applyingReschedule && visit.registrationFeeNaira > 0) {
      await tx.user.update({ where: { id: visit.patientUserId }, data: { registrationPaidYear: lagosCalendarYear() } });
    }
    await writeAudit(tx, visit.patientUserId, "payment.verify", `Verified ${reference} for ${visit.reference}`, { type: "payment", id: current.id });
    await notifyUser(tx, visit.patientUserId, "Payment verified", `${visit.reference} is confirmed.`, `/patient/appointments/${visit.id}`);
    return updated;
  });
  return { status: "verified", duplicate: false, appointment: publicAppointment(appointment) };
}
