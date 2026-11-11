import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { nextCounter, notifyUser, reference, writeAudit } from "../lib/audit";
import { hashPassword } from "../lib/auth";
import { applyDispense, canSetQueue, scoreRating } from "../domain/care";
import { calculateFees, lagosCalendarYear, lagosDayKey, queueAfterArrival, registrationIsDue } from "../domain/scheduling";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { feesFrom, policiesFrom, publicAdmission, publicAdministration, publicAppointment, publicBed, publicDeskPayment, publicDispense, publicHandover, publicInventory, publicJourney, publicObservation, publicObservationOrder, publicOrder, publicRating, publicShift, publicTask, publicUser, publicWard } from "../lib/present";
import { assertRole, requireUser, settings, slotKey, SUPER_CONSULTANT_SLUG } from "./shared";

const RUNNERS = new Set(["OOUTH-S-DESK-2", "OOUTH-S-DESK-3"]);

export function createOperationsService(prisma: PrismaClient) {
  return {
    async registerDeskPatient(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["desk_officer"]);
      const input = z.object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        dateOfBirth: z.string().min(4),
        gender: z.enum(["female", "male", "unspecified"]),
        phone: z.string().trim().min(7),
        address: z.string().trim().min(3),
        emergencyContactName: z.string().optional().default(""),
        emergencyContactPhone: z.string().optional().default(""),
        email: z.string().trim().email().optional().or(z.literal("")),
      }).parse(body);
      const year = lagosCalendarYear();
      const created = await prisma.$transaction(async (tx) => {
        const seq = await nextCounter(tx, `patient-${year}`);
        const email = input.email || `desk.${seq}@patients.oouth.local`;
        const password = `Desk#${seq}${year}`;
        const user = await tx.user.create({
          data: {
            role: "patient",
            firstName: input.firstName,
            lastName: input.lastName,
            email: email.toLowerCase(),
            phone: input.phone,
            dateOfBirth: input.dateOfBirth,
            gender: input.gender,
            address: input.address,
            emergencyContactName: input.emergencyContactName,
            emergencyContactPhone: input.emergencyContactPhone,
            passwordHash: await hashPassword(password),
            patientNumber: reference("OOUTH-P", year, seq),
          },
        });
        await writeAudit(tx, actor.id, "patient.register", `Desk registered ${user.patientNumber}`, { type: "user", id: user.id });
        return { user, password };
      });
      return { ...publicUser(created.user), password: created.password };
    },

    async updateDeskPatient(actorId: string, patientId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["desk_officer", "administrator"]);
      const input = z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        gender: z.string().optional(),
        dateOfBirth: z.string().optional(),
        emergencyContactName: z.string().optional(),
        emergencyContactPhone: z.string().optional(),
      }).parse(body);
      const patient = await prisma.user.findFirst({ where: { id: patientId, role: "patient" } });
      if (!patient) throw notFound("That patient was not found.");
      const updated = await prisma.user.update({ where: { id: patientId }, data: input });
      await writeAudit(prisma, actor.id, "patient.update", `Updated ${patient.patientNumber}`, { type: "user", id: patientId });
      return publicUser(updated);
    },

    async createVisit(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["desk_officer"]);
      const input = z.object({
        patientId: z.string().uuid(),
        departmentSlug: z.string().optional().default(""),
        consultantSlug: z.string().optional().default(SUPER_CONSULTANT_SLUG),
        consultationType: z.enum(["physical", "virtual"]).default("physical"),
        reason: z.string().trim().min(2),
        startsAt: z.string().optional(),
      }).parse(body);
      const patient = await prisma.user.findFirst({ where: { id: input.patientId, role: "patient" } });
      if (!patient) throw notFound("That patient was not found.");
      const hospital = await settings(prisma);
      const fees = calculateFees(
        { consultationPerHourNaira: hospital.consultationPerHourNaira, registrationFeeNaira: hospital.registrationFeeNaira, defaultDurationMinutes: hospital.defaultDurationMinutes },
        hospital.defaultDurationMinutes,
        registrationIsDue(patient.registrationPaidYear),
      );
      const starts = input.startsAt ? new Date(input.startsAt) : new Date();
      const year = lagosCalendarYear();
      const created = await prisma.$transaction(async (tx) => {
        const seq = await nextCounter(tx, `apt-${year}`);
        const appointment = await tx.appointment.create({
          data: {
            reference: reference("OOUTH-APT", year, seq),
            patientUserId: patient.id,
            consultantSlug: input.consultantSlug || SUPER_CONSULTANT_SLUG,
            departmentSlug: input.departmentSlug,
            consultationType: input.consultationType,
            startsAt: starts,
            endsAt: new Date(starts.getTime() + hospital.defaultDurationMinutes * 60_000),
            reason: input.reason,
            status: "pending_payment",
            paymentStatus: "pending_verification",
            amountNaira: fees.totalNaira,
            consultationFeeNaira: fees.consultationNaira,
            registrationFeeNaira: fees.registrationNaira,
            durationMinutes: fees.durationMinutes,
            privacyConsent: true,
            suggestedDepartmentSlugs: [],
            bookingSource: "walk_in",
            slotKey: slotKey(input.consultantSlug || SUPER_CONSULTANT_SLUG, starts),
          },
        });
        const journeySeq = await nextCounter(tx, `enc-${year}`);
        const journey = await tx.journey.create({
          data: {
            reference: reference("OOUTH-ENC", year, journeySeq),
            appointmentId: appointment.id,
            patientUserId: patient.id,
            departmentSlug: input.departmentSlug,
            consultantSlug: appointment.consultantSlug,
            queueStatus: "awaiting_payment",
            registeredByUserId: actor.id,
          },
        });
        await writeAudit(tx, actor.id, "desk.visit", `Opened ${appointment.reference}`, { type: "appointment", id: appointment.id });
        return { appointment, journey };
      });
      return { appointmentId: created.appointment.id, journeyId: created.journey.id, reference: created.appointment.reference };
    },

    async deskPayment(actorId: string, patientId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["desk_officer"]);
      const input = z.object({
        durationHours: z.union([z.literal(1), z.literal(2)]),
        status: z.enum(["pending", "paid"]),
        amountReceived: z.number().int().nonnegative(),
        reference: z.string().optional(),
        departmentSlug: z.string().optional(),
        consultantSlug: z.string().optional(),
        appointmentId: z.string().uuid().optional(),
      }).parse(body);
      const patient = await prisma.user.findFirst({ where: { id: patientId, role: "patient" } });
      if (!patient) throw notFound("That patient was not found.");
      const hospital = await settings(prisma);
      const fees = calculateFees(
        { consultationPerHourNaira: hospital.consultationPerHourNaira, registrationFeeNaira: hospital.registrationFeeNaira, defaultDurationMinutes: hospital.defaultDurationMinutes },
        input.durationHours * 60,
        registrationIsDue(patient.registrationPaidYear),
      );
      const year = lagosCalendarYear();
      const result = await prisma.$transaction(async (tx) => {
        const appointment = input.appointmentId
          ? await tx.appointment.findFirst({ where: { id: input.appointmentId, patientUserId: patient.id } })
          : await tx.appointment.findFirst({ where: { patientUserId: patient.id, bookingSource: "walk_in", status: { notIn: ["cancelled", "completed"] }, paymentStatus: { not: "verified" } }, orderBy: { createdAt: "desc" } });
        if (!appointment) throw notFound("That visit was not found.");
        const seq = await nextCounter(tx, `deskpay-${year}`);
        const payment = await tx.deskPayment.create({
          data: {
            reference: input.reference || reference("OOUTH-PAY", year, seq),
            patientUserId: patient.id,
            appointmentId: appointment.id,
            consultantSlug: input.consultantSlug || appointment.consultantSlug,
            departmentSlug: input.departmentSlug || appointment.departmentSlug,
            durationHours: input.durationHours,
            registrationFeeNaira: fees.registrationNaira,
            consultationFeeNaira: fees.consultationNaira,
            totalNaira: fees.totalNaira,
            status: input.status,
            amountReceived: input.amountReceived,
            paidAt: input.status === "paid" ? new Date() : null,
            verifiedByUserId: input.status === "paid" ? actor.id : null,
          },
        });
        if (input.status === "paid") {
          await tx.appointment.update({
            where: { id: appointment.id },
            data: {
              paymentStatus: "verified",
              status: appointment.status === "pending_payment" ? "confirmed" : appointment.status,
              amountNaira: fees.totalNaira,
              consultationFeeNaira: fees.consultationNaira,
              registrationFeeNaira: fees.registrationNaira,
              durationMinutes: input.durationHours * 60,
              durationHours: input.durationHours,
              departmentSlug: input.departmentSlug || appointment.departmentSlug,
              consultantSlug: input.consultantSlug || appointment.consultantSlug,
              paymentReference: payment.reference,
            },
          });
          if (fees.registrationNaira > 0) await tx.user.update({ where: { id: patient.id }, data: { registrationPaidYear: year } });
        }
        await writeAudit(tx, actor.id, "desk.payment", `${input.status} ${payment.reference}`, { type: "deskPayment", id: payment.id });
        return { appointmentId: appointment.id, paymentId: payment.id, totalNaira: fees.totalNaira, reference: payment.reference };
      });
      return result;
    },

    async checkIn(actorId: string, appointmentId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["desk_officer"]);
      const input = z.object({ mode: z.enum(["check_in", "early"]), overrideReason: z.string().optional() }).parse(body);
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) throw notFound("That visit was not found.");
      const open = await prisma.journey.findFirst({ where: { appointmentId, queueStatus: { notIn: ["completed", "cancelled"] } } });
      if (open?.arrivedAt) throw conflict("This visit is already checked in.");
      const paid = appointment.paymentStatus === "verified";
      if (!paid && !input.overrideReason?.trim()) throw badRequest("An unpaid visit needs a recorded payment or an override reason.");
      const busy = await prisma.appointment.findFirst({ where: { consultantSlug: appointment.consultantSlug, status: "in_progress", id: { not: appointment.id } } });
      const queueStatus = queueAfterArrival({ early: input.mode === "early", paid, consultantBusy: Boolean(busy) });
      const year = lagosCalendarYear();
      const journey = await prisma.$transaction(async (tx) => {
        const current = open ?? await tx.journey.create({
          data: {
            reference: reference("OOUTH-ENC", year, await nextCounter(tx, `enc-${year}`)),
            appointmentId,
            patientUserId: appointment.patientUserId,
            departmentSlug: appointment.departmentSlug,
            consultantSlug: appointment.consultantSlug,
            queueStatus,
            registeredByUserId: actor.id,
            arrivedAt: new Date(),
          },
        });
        const updated = open
          ? await tx.journey.update({ where: { id: current.id }, data: { queueStatus, arrivedAt: new Date() } })
          : current;
        await tx.journeyEvent.create({
          data: { journeyId: updated.id, appointmentId, type: "checked_in", actorId: actor.id, actorName: `${actor.firstName} ${actor.lastName}`, departmentSlug: appointment.departmentSlug, status: queueStatus, relatedReference: input.overrideReason ?? "" },
        });
        await writeAudit(tx, actor.id, "desk.check-in", `Checked in ${appointment.reference}`, { type: "journey", id: updated.id });
        return updated;
      });
      return { queueStatus: journey.queueStatus, journeyId: journey.id };
    },

    async collect(actorId: string, recordId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      if (actor.role !== "desk_officer" || !actor.staffId || !RUNNERS.has(actor.staffId)) throw forbidden("Only desk officer 2 or 3 can collect this request.");
      const input = z.object({ kind: z.enum(["pharmacy", "laboratory", "imaging"]) }).parse(body);
      const now = new Date();
      if (input.kind === "pharmacy") {
        const row = await prisma.dispense.findUnique({ where: { id: recordId } });
        if (!row) throw notFound("That request was not found.");
        await prisma.dispense.update({ where: { id: recordId }, data: { collectedAt: now, collectedByUserId: actor.id } });
      } else {
        const row = await prisma.investigationOrder.findUnique({ where: { id: recordId } });
        if (!row || row.kind !== input.kind) throw notFound("That request was not found.");
        await prisma.investigationOrder.update({ where: { id: recordId }, data: { collectedAt: now, collectedByUserId: actor.id } });
      }
      await writeAudit(prisma, actor.id, "desk.collect", `Collected ${input.kind} ${recordId}`, { type: input.kind, id: recordId });
      return { ok: true, collectedAt: now.toISOString() };
    },

    async setQueue(actorId: string, journeyId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      const input = z.object({ queueStatus: z.string(), reason: z.string().optional() }).parse(body);
      if (actor.role !== "desk_officer" && actor.role !== "consultant" && actor.role !== "nurse") throw forbidden("You cannot change the queue.");
      if (!canSetQueue(actor.role, input.queueStatus)) throw forbidden("You cannot set that queue status.");
      const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
      if (!journey) throw notFound("That journey was not found.");
      const updated = await prisma.journey.update({ where: { id: journeyId }, data: { queueStatus: input.queueStatus } });
      await writeAudit(prisma, actor.id, "desk.queue", `Queue ${journey.reference} is ${input.queueStatus}`, { type: "journey", id: journeyId });
      return publicJourney(updated);
    },

    async dispense(actorId: string, id: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["pharmacist"]);
      const input = z.object({
        action: z.enum(["verify", "review", "clarify", "full", "partial", "unavailable", "cancel"]),
        quantity: z.number().optional(),
        instructions: z.string().optional().default(""),
        substitution: z.string().optional().default(""),
        clarification: z.string().optional().default(""),
      }).parse(body);
      const record = await prisma.dispense.findUnique({ where: { id } });
      if (!record) throw notFound("That prescription line was not found.");
      const stock = await prisma.inventoryItem.findFirst({ where: { name: { equals: record.medicationName, mode: "insensitive" }, deletedAt: null } });
      const result = applyDispense(record, stock ? stock.quantity : null, input.action === "clarify"
        ? { kind: "clarify", clarification: input.clarification }
        : input.action === "full" || input.action === "partial" || input.action === "unavailable"
          ? { kind: input.action, quantity: input.quantity ?? 0, instructions: input.instructions, substitution: input.substitution }
          : { kind: input.action });
      if (!result.ok) throw badRequest(result.error);
      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.dispense.update({ where: { id }, data: result.patch });
        if ("stockDelta" in result && result.stockDelta && stock) {
          await tx.inventoryItem.update({ where: { id: stock.id }, data: { quantity: { decrement: result.stockDelta } } });
        }
        await writeAudit(tx, actor.id, "pharmacy.dispense", `${input.action} ${record.reference}`, { type: "dispense", id });
        return next;
      });
      return publicDispense(updated);
    },

    async diagnostic(actorId: string, id: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      const input = z.object({
        status: z.string().optional(),
        resultText: z.string().optional(),
        resultFileName: z.string().optional(),
        interpretation: z.string().optional(),
        release: z.boolean().optional(),
      }).parse(body);
      const order = await prisma.investigationOrder.findUnique({ where: { id } });
      if (!order) throw notFound("That order was not found.");
      if (input.release || input.interpretation) {
        if (actor.role !== "consultant" || (actor.consultantSlug !== order.consultantSlug && actor.consultantSlug !== SUPER_CONSULTANT_SLUG)) throw forbidden("Only the assigned consultant can release this result.");
      } else if (actor.role !== "laboratory_officer") throw forbidden("Only a laboratory officer can process this order.");
      const updated = await prisma.investigationOrder.update({
        where: { id },
        data: {
          status: input.release ? "result_reviewed" : input.status ?? order.status,
          resultText: input.resultText ?? order.resultText,
          resultFileName: input.resultFileName ?? order.resultFileName,
          interpretation: input.interpretation ?? order.interpretation,
          releasedToPatient: input.release ? true : order.releasedToPatient,
          performingOfficerUserId: actor.role === "laboratory_officer" ? actor.id : order.performingOfficerUserId,
        },
      });
      await writeAudit(prisma, actor.id, "diagnostics.update", `Updated ${order.reference}`, { type: "order", id });
      return publicOrder(updated);
    },

    async administer(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse"]);
      const input = z.object({
        patientUserId: z.string().uuid(),
        appointmentId: z.string().uuid(),
        encounterId: z.string().uuid(),
        medicationItemId: z.string(),
        medicationName: z.string(),
        outcome: z.enum(["administered", "not_administered", "delayed", "held", "refused", "discontinued"]),
        reason: z.string().optional().default(""),
        dose: z.string(),
        route: z.string(),
        scheduledFor: z.string(),
        note: z.string().optional().default(""),
        confirmed: z.boolean(),
      }).parse(body);
      if (!input.confirmed) throw badRequest("Confirm the administration record before saving.");
      if (input.outcome !== "administered" && !input.reason.trim()) throw badRequest("Enter a reason when the medicine is not given.");
      const duplicate = await prisma.medicationAdministration.findFirst({ where: { medicationItemId: input.medicationItemId, scheduledFor: input.scheduledFor } });
      if (duplicate) throw conflict("This dose is already recorded.");
      const created = await prisma.medicationAdministration.create({
        data: {
          patientUserId: input.patientUserId,
          appointmentId: input.appointmentId,
          encounterId: input.encounterId,
          medicationItemId: input.medicationItemId,
          medicationName: input.medicationName,
          outcome: input.outcome,
          reason: input.reason.trim(),
          dose: input.dose,
          route: input.route,
          scheduledFor: input.scheduledFor,
          note: input.note.trim(),
          nurseUserId: actor.id,
        },
      });
      await writeAudit(prisma, actor.id, "nursing.administration", `Recorded ${input.medicationName}`, { type: "administration", id: created.id });
      return publicAdministration(created);
    },

    async observationOrder(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["consultant"]);
      const input = z.object({ patientId: z.string().uuid(), level: z.enum(["L1", "L2", "L3", "L4"]), intervalMinutes: z.number().int().positive(), instructions: z.string().optional().default("") }).parse(body);
      const now = new Date();
      const created = await prisma.$transaction(async (tx) => {
        await tx.observationOrder.updateMany({ where: { patientUserId: input.patientId, active: true }, data: { active: false, endAt: now } });
        return tx.observationOrder.create({
          data: { patientUserId: input.patientId, level: input.level, intervalMinutes: input.intervalMinutes, assignedByUserId: actor.id, startAt: now, instructions: input.instructions, active: true },
        });
      });
      await writeAudit(prisma, actor.id, "nursing.observation-order", `Set ${input.level} observations`, { type: "observationOrder", id: created.id });
      return publicObservationOrder(created);
    },

    async observation(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse"]);
      const input = z.object({
        patientUserId: z.string().uuid(),
        appointmentId: z.string().optional(),
        readings: z.array(z.object({ name: z.string(), value: z.string(), unit: z.string() })),
        note: z.string().optional().default(""),
        behaviour: z.string().optional().default(""),
        risk: z.enum(["low", "moderate", "high", "critical"]).optional(),
      }).parse(body);
      const order = await prisma.observationOrder.findFirst({ where: { patientUserId: input.patientUserId, active: true } });
      const recordedAt = new Date();
      const nextDueAt = order ? new Date(recordedAt.getTime() + order.intervalMinutes * 60_000) : null;
      const created = await prisma.observation.create({
        data: { ...input, nurseUserId: actor.id, recordedAt, orderId: order?.id, nextDueAt, readings: input.readings },
      });
      await writeAudit(prisma, actor.id, "nursing.observation", "Recorded observations", { type: "observation", id: created.id });
      return { ...publicObservation(created), nextDueAt: nextDueAt?.toISOString() };
    },

    async handover(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse"]);
      const input = z.object({
        id: z.string().optional(),
        shiftId: z.string(),
        patientUserId: z.string().optional().default(""),
        generalSummary: z.string().trim().min(1),
        patientUpdates: z.string().optional().default(""),
        medicationUpdates: z.string().optional().default(""),
        observationUpdates: z.string().optional().default(""),
        pendingTasksNote: z.string().optional().default(""),
        outstandingInvestigations: z.string().optional().default(""),
        clinicalConcerns: z.string().optional().default(""),
        nextInstructions: z.string().optional().default(""),
        mode: z.enum(["draft", "submit", "amend"]),
        amendsId: z.string().optional(),
      }).parse(body);
      if (input.mode !== "amend" && input.id) {
        const existing = await prisma.handover.findUnique({ where: { id: input.id } });
        if (existing?.status === "submitted") throw conflict("A submitted handover is kept and cannot be overwritten.");
      }
      const status = input.mode === "submit" || input.mode === "amend" ? "submitted" : "draft";
      const data = {
        shiftId: input.shiftId,
        patientUserId: input.patientUserId,
        authorUserId: actor.id,
        generalSummary: input.generalSummary,
        patientUpdates: input.patientUpdates,
        medicationUpdates: input.medicationUpdates,
        observationUpdates: input.observationUpdates,
        pendingTasksNote: input.pendingTasksNote,
        outstandingInvestigations: input.outstandingInvestigations,
        clinicalConcerns: input.clinicalConcerns,
        nextInstructions: input.nextInstructions,
        condition: input.generalSummary,
        observations: input.observationUpdates,
        medicationsGiven: input.medicationUpdates,
        pendingMedication: input.medicationUpdates,
        pendingTasks: input.pendingTasksNote,
        changes: input.patientUpdates,
        issues: input.clinicalConcerns,
        status,
        amendsId: input.amendsId,
      };
      const saved = input.mode === "amend" || !input.id
        ? await prisma.handover.create({ data })
        : await prisma.handover.update({ where: { id: input.id }, data });
      await writeAudit(prisma, actor.id, "nursing.handover", `${input.mode} handover`, { type: "handover", id: saved.id });
      return { id: saved.id, status: saved.status };
    },

    async acknowledgeHandover(actorId: string, id: string) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse"]);
      const handover = await prisma.handover.findUnique({ where: { id } });
      if (!handover) throw notFound("That handover was not found.");
      if (handover.authorUserId === actor.id) throw forbidden("You cannot acknowledge your own handover.");
      const updated = await prisma.handover.update({ where: { id }, data: { status: "acknowledged", acknowledgedByUserId: actor.id, acknowledgedAt: new Date() } });
      await writeAudit(prisma, actor.id, "nursing.handover", "Acknowledged a handover", { type: "handover", id });
      return publicHandover(updated);
    },

    async rate(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["patient"]);
      const input = z.object({
        appointmentId: z.string().uuid(),
        overall: z.number().int(),
        communication: z.number().int(),
        professionalism: z.number().int(),
        attention: z.number().int(),
        feedback: z.string().optional().default(""),
      }).parse(body);
      const message = scoreRating([input.overall, input.communication, input.professionalism, input.attention]);
      if (message) throw badRequest(message);
      const appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId } });
      if (!appointment || appointment.patientUserId !== actor.id) throw forbidden("You can only rate your own visit.");
      if (appointment.status !== "completed") throw forbidden("Rate a consultation after it is completed.");
      const encounter = await prisma.encounter.findFirst({ where: { appointmentId: appointment.id }, orderBy: { version: "desc" } });
      if (!encounter) throw forbidden("The consultation summary is not available yet.");
      const existing = await prisma.rating.findUnique({ where: { appointmentId: appointment.id } });
      if (existing) throw conflict("This consultation already has a rating.");
      const created = await prisma.rating.create({
        data: { appointmentId: appointment.id, patientUserId: actor.id, consultantSlug: appointment.consultantSlug, encounterId: encounter.id, overall: input.overall, communication: input.communication, professionalism: input.professionalism, attention: input.attention, feedback: input.feedback.trim() },
      });
      await writeAudit(prisma, actor.id, "rating.create", `Rated ${appointment.reference}`, { type: "rating", id: created.id });
      return publicRating(created);
    },

    async moderateRating(actorId: string, id: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({ hidden: z.boolean() }).parse(body);
      const updated = await prisma.rating.update({ where: { id }, data: { hidden: input.hidden } });
      await writeAudit(prisma, actor.id, "rating.moderate", `${input.hidden ? "Hid" : "Showed"} a rating`, { type: "rating", id });
      return publicRating(updated);
    },

    async saveInventory(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["pharmacist", "administrator"]);
      const input = z.object({ id: z.string().optional(), name: z.string().min(1), category: z.string(), quantity: z.number().int(), unit: z.string(), reorderLevel: z.number().int() }).parse(body);
      const saved = input.id
        ? await prisma.inventoryItem.update({ where: { id: input.id }, data: input })
        : await prisma.inventoryItem.create({ data: input });
      await writeAudit(prisma, actor.id, "pharmacy.inventory", `Saved ${saved.name}`, { type: "inventory", id: saved.id });
      return publicInventory(saved);
    },

    async saveStaff(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({
        id: z.string().optional(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        role: z.enum(["consultant", "administrator", "desk_officer", "nurse", "pharmacist", "laboratory_officer"]),
        departmentSlug: z.string().optional().default(""),
        designation: z.string().optional().default(""),
        consultantSlug: z.string().optional(),
        active: z.boolean().default(true),
      }).parse(body);
      if (input.id) {
        const updated = await prisma.user.update({
          where: { id: input.id },
          data: { firstName: input.firstName, lastName: input.lastName, email: input.email.toLowerCase(), role: input.role, departmentSlug: input.departmentSlug, designation: input.designation, consultantSlug: input.consultantSlug, active: input.active },
        });
        await writeAudit(prisma, actor.id, "staff.update", `Updated ${updated.email}`, { type: "user", id: updated.id });
        return publicUser(updated);
      }
      const year = lagosCalendarYear();
      const seq = await nextCounter(prisma, `staff-${year}`);
      const password = `Staff#${year}${seq}`;
      const created = await prisma.user.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email.toLowerCase(),
          role: input.role,
          departmentSlug: input.departmentSlug,
          designation: input.designation,
          consultantSlug: input.consultantSlug,
          active: input.active,
          staffId: reference("OOUTH-S", year, seq),
          passwordHash: await hashPassword(password),
          phone: "",
        },
      });
      await writeAudit(prisma, actor.id, "staff.create", `Created ${created.email}`, { type: "user", id: created.id });
      return { ...publicUser(created), password };
    },

    async fees(actorId: string) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      return prisma.hospitalSettings.findUnique({ where: { id: "default" } });
    },

    async updateFees(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({ consultationPerHourNaira: z.number().int().positive(), registrationFeeNaira: z.number().int().nonnegative(), defaultDurationMinutes: z.number().int().positive() }).parse(body);
      const updated = await prisma.hospitalSettings.update({ where: { id: "default" }, data: input });
      await writeAudit(prisma, actor.id, "admin.fees", "Updated fees");
      return feesFrom(updated);
    },

    async updatePolicies(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({ cancellationNoticeHours: z.number().int().nonnegative(), rescheduleNoticeHours: z.number().int().nonnegative(), joinMinutesBefore: z.number().int().nonnegative(), joinMinutesAfter: z.number().int().nonnegative() }).parse(body);
      const updated = await prisma.hospitalSettings.update({ where: { id: "default" }, data: input });
      await writeAudit(prisma, actor.id, "admin.policies", "Updated policies");
      return policiesFrom(updated);
    },

    async setBooking(actorId: string, slug: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({ onlineBookingEnabled: z.boolean() }).parse(body);
      const consultant = await prisma.user.findFirst({ where: { consultantSlug: slug, role: "consultant" } });
      if (!consultant) throw notFound("That consultant was not found.");
      const updated = await prisma.user.update({ where: { id: consultant.id }, data: { onlineBookingEnabled: input.onlineBookingEnabled } });
      await writeAudit(prisma, actor.id, "admin.booking", `${slug} booking ${input.onlineBookingEnabled ? "on" : "off"}`);
      return publicUser(updated);
    },

    async availability(actorId: string, slug: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      const owns = actor.role === "consultant" && actor.consultantSlug === slug;
      if (!owns && actor.role !== "administrator") throw forbidden("You cannot change this schedule.");
      const input = z.object({
        days: z.array(z.number().int().min(0).max(6)),
        startTime: z.string(),
        endTime: z.string(),
        durationMinutes: z.number().int().positive(),
        breaks: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
        blockedDates: z.array(z.string()).default([]),
        physicalEnabled: z.boolean(),
        virtualEnabled: z.boolean(),
      }).parse(body);
      const saved = await prisma.availability.upsert({
        where: { consultantSlug: slug },
        create: { consultantSlug: slug, ...input, provisional: false },
        update: { ...input, provisional: false },
      });
      await writeAudit(prisma, actor.id, "consultant.availability", `Updated availability for ${slug}`);
      return saved;
    },

    async profile(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      if (actor.role !== "patient") throw forbidden("Sign in as a patient to update this profile.");
      const input = z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        gender: z.string().optional(),
        dateOfBirth: z.string().optional(),
      }).parse(body);
      const updated = await prisma.user.update({ where: { id: actor.id }, data: input });
      await writeAudit(prisma, actor.id, "patient.profile", "Updated patient profile");
      return publicUser(updated);
    },

    async readNotification(actorId: string, id: string) {
      const note = await prisma.notification.findUnique({ where: { id } });
      if (!note || note.userId !== actorId) throw notFound("That notice was not found.");
      return prisma.notification.update({ where: { id }, data: { read: true } });
    },

    async listNotifications(actorId: string) {
      return prisma.notification.findMany({ where: { userId: actorId }, orderBy: { createdAt: "desc" }, take: 50 });
    },

    async dashboard(actorId: string, role: string) {
      const actor = await requireUser(prisma, actorId);
      if (actor.role !== role) throw forbidden("You can only open your own overview.");
      const today = lagosDayKey(new Date().toISOString());
      if (role === "consultant") {
        const where = actor.consultantSlug === SUPER_CONSULTANT_SLUG ? {} : { consultantSlug: actor.consultantSlug ?? "" };
        const appointments = await prisma.appointment.findMany({ where });
        const encounters = await prisma.encounter.findMany({ where: { appointmentId: { in: appointments.map((item) => item.id) } } });
        return {
          total: appointments.length,
          today: appointments.filter((item) => lagosDayKey(item.startsAt.toISOString()) === today).length,
          physical: appointments.filter((item) => item.consultationType === "physical" && item.status !== "cancelled").length,
          virtual: appointments.filter((item) => item.consultationType === "virtual" && item.status !== "cancelled").length,
          waiting: appointments.filter((item) => ["confirmed", "scheduled", "awaiting_triage"].includes(item.status)).length,
          inProgress: appointments.filter((item) => item.status === "in_progress").length,
          completed: appointments.filter((item) => item.status === "completed").length,
          cancelled: appointments.filter((item) => item.status === "cancelled").length,
          missed: appointments.filter((item) => item.status === "no_show").length,
          rescheduled: 0,
          pendingPayment: appointments.filter((item) => item.paymentStatus !== "verified" && item.status !== "cancelled").length,
          signed: new Set(encounters.map((item) => item.appointmentId)).size,
          uniquePatients: new Set(appointments.map((item) => item.patientUserId)).size,
        };
      }
      if (role === "desk_officer") {
        const appointments = await prisma.appointment.findMany();
        const registrations = await prisma.auditEvent.count({ where: { action: "patient.register" } });
        return {
          registrationsToday: registrations,
          openVisits: appointments.filter((item) => !["cancelled", "completed", "no_show"].includes(item.status)).length,
          awaitingPayment: appointments.filter((item) => item.paymentStatus !== "verified" && item.status !== "cancelled").length,
          waitingForConsultant: appointments.filter((item) => ["confirmed", "scheduled"].includes(item.status)).length,
          inProgress: appointments.filter((item) => item.status === "in_progress").length,
          completedToday: appointments.filter((item) => item.status === "completed" && lagosDayKey(item.updatedAt.toISOString()) === today).length,
        };
      }
      if (role === "nurse") {
        const appointments = await prisma.appointment.findMany();
        const meds = await prisma.dispense.count();
        return { inProgress: appointments.filter((item) => item.status === "in_progress").length, today: appointments.filter((item) => lagosDayKey(item.startsAt.toISOString()) === today).length, medicationOrders: meds };
      }
      if (role === "pharmacist") {
        const pending = await prisma.dispense.count({ where: { status: { in: ["pending_pharmacy", "under_review", "awaiting_clarification"] } } });
        const lines = await prisma.dispense.count();
        return { pendingOrders: pending, medicationLines: lines };
      }
      const orders = await prisma.investigationOrder.findMany();
      return { encounters: new Set(orders.map((item) => item.encounterId)).size, laboratoryTests: orders.filter((item) => item.kind === "laboratory").length, scans: orders.filter((item) => item.kind === "imaging").length, orders: orders.length };
    },

    async lists(actorId: string, kind: string) {
      const actor = await requireUser(prisma, actorId);
      if (["journeys", "deskPayments"].includes(kind)) assertRole(actor, ["desk_officer", "administrator", "consultant"]);
      else if (["dispenses", "inventory"].includes(kind)) assertRole(actor, ["pharmacist", "administrator"]);
      else if (kind === "orders") assertRole(actor, ["laboratory_officer", "consultant", "administrator"]);
      else if (["observations", "observationOrders", "tasks", "shifts", "handovers", "wards", "beds", "admissions", "administrations"].includes(kind)) assertRole(actor, ["nurse", "consultant", "administrator"]);
      else if (kind === "ratings") assertRole(actor, ["administrator", "consultant"]);
      else throw notFound("That list was not found.");
      if (kind === "dispenses") return (await prisma.dispense.findMany({ orderBy: { createdAt: "desc" }, take: 200 })).map(publicDispense);
      if (kind === "inventory") return (await prisma.inventoryItem.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } })).map(publicInventory);
      if (kind === "orders") return (await prisma.investigationOrder.findMany({ orderBy: { createdAt: "desc" }, take: 200 })).map(publicOrder);
      if (kind === "observations") return (await prisma.observation.findMany({ orderBy: { recordedAt: "desc" }, take: 200 })).map(publicObservation);
      if (kind === "observationOrders") return (await prisma.observationOrder.findMany({ orderBy: { assignedAt: "desc" } })).map(publicObservationOrder);
      if (kind === "tasks") return (await prisma.nursingTask.findMany({ orderBy: { createdAt: "desc" } })).map(publicTask);
      if (kind === "shifts") return (await prisma.shift.findMany({ orderBy: { startedAt: "desc" } })).map(publicShift);
      if (kind === "handovers") return (await prisma.handover.findMany({ orderBy: { createdAt: "desc" } })).map(publicHandover);
      if (kind === "wards") return (await prisma.ward.findMany()).map(publicWard);
      if (kind === "beds") return (await prisma.bed.findMany({ orderBy: { label: "asc" } })).map(publicBed);
      if (kind === "admissions") return (await prisma.admission.findMany({ orderBy: { admittedAt: "desc" } })).map(publicAdmission);
      if (kind === "administrations") return (await prisma.medicationAdministration.findMany({ orderBy: { recordedAt: "desc" } })).map(publicAdministration);
      if (kind === "journeys") return (await prisma.journey.findMany({ orderBy: { createdAt: "desc" }, take: 200 })).map(publicJourney);
      if (kind === "deskPayments") return (await prisma.deskPayment.findMany({ orderBy: { createdAt: "desc" }, take: 200 })).map(publicDeskPayment);
      if (kind === "ratings") return (await prisma.rating.findMany({ orderBy: { createdAt: "desc" } })).map(publicRating);
      throw notFound("That list was not found.");
    },

    async startShift(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse"]);
      const input = z.object({ wardId: z.string() }).parse(body);
      const open = await prisma.shift.findFirst({ where: { nurseUserId: actor.id, endedAt: null } });
      if (open) throw conflict("End the current shift before starting another.");
      const created = await prisma.shift.create({ data: { nurseUserId: actor.id, wardId: input.wardId } });
      return publicShift(created);
    },

    async endShift(actorId: string, id: string) {
      const actor = await requireUser(prisma, actorId);
      const shift = await prisma.shift.findFirst({ where: { id, nurseUserId: actor.id, endedAt: null } });
      if (!shift) throw notFound("This shift is not open for you.");
      return publicShift(await prisma.shift.update({ where: { id }, data: { endedAt: new Date() } }));
    },

    async assignBed(actorId: string, bedId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse", "desk_officer", "administrator"]);
      const input = z.object({ patientUserId: z.string().uuid().nullable() }).parse(body);
      const bed = await prisma.bed.update({ where: { id: bedId }, data: { patientUserId: input.patientUserId } });
      await writeAudit(prisma, actor.id, "nursing.bed", `Assigned bed ${bed.label}`, { type: "bed", id: bedId });
      return publicBed(bed);
    },

    async admit(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse", "consultant", "desk_officer"]);
      const input = z.object({ patientUserId: z.string().uuid(), appointmentId: z.string().optional(), wardId: z.string(), bedId: z.string(), consultantSlug: z.string(), diagnosisLabel: z.string().optional().default(""), plan: z.string().optional().default("") }).parse(body);
      const created = await prisma.admission.create({ data: input });
      await prisma.bed.update({ where: { id: input.bedId }, data: { patientUserId: input.patientUserId } });
      await writeAudit(prisma, actor.id, "nursing.admission", "Admitted a patient", { type: "admission", id: created.id });
      return publicAdmission(created);
    },

    async admissionStatus(actorId: string, id: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse", "consultant"]);
      const input = z.object({ dischargeStatus: z.enum(["admitted", "ready", "discharged"]) }).parse(body);
      const updated = await prisma.admission.update({ where: { id }, data: { dischargeStatus: input.dischargeStatus } });
      if (input.dischargeStatus === "discharged") await prisma.bed.update({ where: { id: updated.bedId }, data: { patientUserId: null } });
      return publicAdmission(updated);
    },

    async saveTask(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse"]);
      const input = z.object({
        id: z.string().optional(),
        patientUserId: z.string().uuid(),
        appointmentId: z.string().optional(),
        description: z.string().min(1),
        priority: z.enum(["routine", "urgent"]),
        dueAt: z.string(),
        status: z.enum(["open", "in_progress", "completed", "overdue", "cancelled"]),
        completionNote: z.string().optional().default(""),
      }).parse(body);
      const data = { patientUserId: input.patientUserId, appointmentId: input.appointmentId, assignedNurseUserId: actor.id, description: input.description, priority: input.priority, dueAt: new Date(input.dueAt), status: input.status, completionNote: input.completionNote };
      const saved = input.id ? await prisma.nursingTask.update({ where: { id: input.id }, data }) : await prisma.nursingTask.create({ data });
      return publicTask(saved);
    },

    async catalog(kind: "medications" | "diagnoses" | "imaging-studies" | "laboratory-tests", actorId: string) {
      const actor = await requireUser(prisma, actorId);
      if (!["consultant", "administrator", "pharmacist", "laboratory_officer"].includes(actor.role)) throw forbidden("You cannot open this catalog.");
      if (kind === "medications") return prisma.catalogMedication.findMany({ orderBy: { name: "asc" } });
      if (kind === "diagnoses") return prisma.catalogDiagnosis.findMany({ orderBy: { name: "asc" } });
      if (kind === "imaging-studies") return prisma.catalogImaging.findMany({ orderBy: { name: "asc" } });
      return prisma.catalogLaboratory.findMany({ orderBy: { name: "asc" } });
    },

    async departments(query: { group?: string; booking?: string }) {
      return prisma.department.findMany({
        where: { deletedAt: null, group: query.group, patientBooking: query.booking === "true" ? true : query.booking === "false" ? false : undefined },
        orderBy: { name: "asc" },
      });
    },

    async consultants(query: { department?: string; booking?: string }) {
      const rows = await prisma.user.findMany({
        where: {
          role: "consultant",
          deletedAt: null,
          departmentSlug: query.department,
          onlineBookingEnabled: query.booking === "true" ? true : undefined,
        },
        orderBy: { lastName: "asc" },
      });
      return rows.map((row) => ({
        slug: row.consultantSlug,
        name: `${row.firstName} ${row.lastName}`.trim(),
        specialty: row.specialty ?? "",
        departmentSlug: row.departmentSlug,
        onlineBookingEnabled: row.onlineBookingEnabled,
        note: query.booking === "true" ? undefined : row.consultantNote,
      }));
    },

    async consultant(slug: string) {
      const row = await prisma.user.findFirst({ where: { consultantSlug: slug, role: "consultant", deletedAt: null } });
      if (!row) throw notFound("That consultant was not found.");
      return { slug: row.consultantSlug, name: `${row.firstName} ${row.lastName}`.trim(), specialty: row.specialty ?? "", departmentSlug: row.departmentSlug, onlineBookingEnabled: row.onlineBookingEnabled, note: row.consultantNote };
    },

    async deskStatus(actorId: string, appointmentId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["desk_officer"]);
      const input = z.object({ status: z.enum(["confirmed", "scheduled", "pending_payment", "cancelled", "no_show", "completed"]), reason: z.string().optional() }).parse(body);
      if ((input.status === "cancelled" || input.status === "no_show") && !input.reason?.trim()) throw badRequest("Enter the reason for this status.");
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) throw notFound("That appointment was not found.");
      const updated = await prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: input.status, slotKey: input.status === "cancelled" || input.status === "no_show" ? null : appointment.slotKey },
      });
      if (input.status === "cancelled") await prisma.journey.updateMany({ where: { appointmentId, queueStatus: { not: "completed" } }, data: { queueStatus: "cancelled" } });
      await writeAudit(prisma, actor.id, "appointment.status", `Set ${appointment.reference} to ${input.status}`, { type: "appointment", id: appointmentId });
      return publicAppointment(updated);
    },

    async settleRegistration(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({ userId: z.string().uuid(), settled: z.boolean() }).parse(body);
      const updated = await prisma.user.update({ where: { id: input.userId }, data: { registrationPaidYear: input.settled ? lagosCalendarYear() : null } });
      await writeAudit(prisma, actor.id, "registration.settled", `${input.settled ? "Recorded" : "Cleared"} registration`, { type: "user", id: input.userId });
      return publicUser(updated);
    },

    async saveOperationalDepartment(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({ name: z.string().trim().min(2) }).parse(body);
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const existing = await prisma.department.findUnique({ where: { slug } });
      if (existing) throw conflict("That department already exists.");
      const created = await prisma.department.create({ data: { slug, name: input.name, group: "operational", summary: input.name, body: input.name, patientBooking: false, operational: true } });
      await writeAudit(prisma, actor.id, "department.create", created.name, { type: "department", id: created.id });
      return { id: created.id, slug: created.slug, name: created.name };
    },

    async assignStaffDepartment(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const input = z.object({ userId: z.string().uuid(), departmentSlug: z.string().min(1) }).parse(body);
      const updated = await prisma.user.update({ where: { id: input.userId }, data: { departmentSlug: input.departmentSlug } });
      await writeAudit(prisma, actor.id, "staff.department", `Assigned ${updated.email}`, { type: "user", id: updated.id });
      return publicUser(updated);
    },

    async confirmNoAllergies(actorId: string, patientId: string) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse", "consultant"]);
      const recorded = await prisma.allergy.count({ where: { patientUserId: patientId } });
      if (recorded) throw conflict("Recorded allergies stay on the chart.");
      const updated = await prisma.user.update({ where: { id: patientId }, data: { allergyStatus: "none_known" } });
      await writeAudit(prisma, actor.id, "patient.allergies", "Recorded no known allergies", { type: "user", id: patientId });
      return publicUser(updated);
    },

    async flagClarification(actorId: string, body: unknown) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["nurse"]);
      const input = z.object({ patientUserId: z.string().uuid(), consultantSlug: z.string(), medicationName: z.string().min(1), note: z.string().trim().min(1) }).parse(body);
      const consultant = await prisma.user.findFirst({ where: { consultantSlug: input.consultantSlug, role: "consultant" } });
      if (consultant) await notifyUser(prisma, consultant.id, "A prescription needs clarification", `${input.medicationName}: ${input.note}`, "/consultant/dashboard");
      await writeAudit(prisma, actor.id, "nursing.clarification", input.note, { type: "user", id: input.patientUserId });
      return { ok: true };
    },

    async openStaff(actorId: string, staffId: string) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      const target = await prisma.user.findUnique({ where: { id: staffId } });
      if (!target || target.deletedAt || target.role === "patient" || !target.active) throw forbidden("This staff account cannot be opened.");
      await writeAudit(prisma, actor.id, "auth.preview", `Opened ${target.email}`, { type: "user", id: target.id });
      return target;
    },

    async resetDemo(actorId: string) {
      const actor = await requireUser(prisma, actorId);
      assertRole(actor, ["administrator"]);
      if (process.env.NODE_ENV === "production") throw forbidden("Demo data cannot be reset in production.");
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Appointment", "Allergy", "AuditEvent", "Notification", "IdempotencyKey" CASCADE`);
      await prisma.inventoryItem.updateMany({ where: { name: "Paracetamol", deletedAt: null }, data: { quantity: 100 } });
      await prisma.inventoryItem.updateMany({ where: { name: "Loratadine", deletedAt: null }, data: { quantity: 40 } });
      await writeAudit(prisma, actor.id, "demo.reset", "Reset demonstration visits");
      return { ok: true };
    },
  };
}

export async function availabilityMap(prisma: PrismaClient) {
  return prisma.availability.findMany();
}
