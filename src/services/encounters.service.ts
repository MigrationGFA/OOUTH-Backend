import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { nextCounter, notifyUser, reference, writeAudit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { publicAllergy, publicDocument, publicDraft, publicEncounter, publicRecord } from "../lib/present";
import { buildConsultationReport, buildHandoff, changedEncounterFields, consultationReportReference, normalizeEncounterBody, prescriptionReference, validateEncounter, type EncounterBody } from "../domain/clinical";
import { lagosCalendarYear } from "../domain/scheduling";
import type { Mailer, ObjectStorage } from "../providers";
import { canSeeAppointment, requireUser, SUPER_CONSULTANT_SLUG } from "./shared";

const encounterBodySchema = z.object({
  chiefComplaint: z.string().optional(),
  symptomDuration: z.string().optional(),
  history: z.string().optional(),
  examination: z.string().optional(),
  assessment: z.string().optional(),
  remoteLimitation: z.string().optional(),
  plan: z.string().optional(),
  lifestyleAdvice: z.string().optional(),
  homeCare: z.string().optional(),
  warningSigns: z.string().optional(),
  emergencyInstructions: z.string().optional(),
  nextSteps: z.string().optional(),
  diagnoses: z.array(z.record(z.string())).optional(),
  prescriptionStatus: z.enum(["none", "prescribed"]).optional(),
  medications: z.array(z.record(z.string())).optional(),
  investigations: z.array(z.record(z.union([z.string(), z.boolean()]))).optional(),
  imaging: z.array(z.record(z.union([z.string(), z.boolean()]))).optional(),
  followUp: z.object({
    required: z.boolean(),
    recommendedDate: z.string().optional().default(""),
    consultationType: z.string().optional().default(""),
    reason: z.string().optional().default(""),
  }).optional(),
  referrals: z.array(z.record(z.string())).optional(),
  admissions: z.array(z.record(z.string())).optional(),
  sharedWithPatient: z.boolean().optional(),
}).passthrough();

export function createEncounterService(prisma: PrismaClient, mailer: Mailer, storage: ObjectStorage) {
  return {
    async patchDraft(userId: string, appointmentId: string, body: unknown) {
      const input = z.object({
        expectedRevision: z.number().int().nonnegative(),
        idempotencyKey: z.string().min(8),
      }).and(encounterBodySchema).parse(body);
      const user = await requireUser(prisma, userId);
      const appointment = await ownedVisit(prisma, user, appointmentId);
      const existing = await prisma.encounterDraft.findUnique({ where: { appointmentId } });
      if (existing?.idempotencyKey === input.idempotencyKey) {
        return { revision: existing.revision, fields: publicDraft(existing).body, duplicate: true };
      }
      const currentBody = existing ? normalizeEncounterBody(existing.body as Partial<EncounterBody>) : normalizeEncounterBody({
        chiefComplaint: appointment.reason,
        history: [appointment.symptoms, appointment.medicalHistory].filter(Boolean).join("\n"),
      });
      const revision = existing?.revision ?? 0;
      if (input.expectedRevision !== revision) throw conflict("This draft changed in another session. Reload the latest draft before continuing.");
      const { expectedRevision: _expected, idempotencyKey, ...patch } = input;
      const nextBody = normalizeEncounterBody({ ...currentBody, ...patch } as Partial<EncounterBody>);
      const changed = changedEncounterFields(currentBody, nextBody);
      if (changed.length === 0) return { revision, fields: currentBody, duplicate: false };
      const saved = await prisma.encounterDraft.upsert({
        where: { appointmentId },
        create: { appointmentId, authorUserId: user.id, baseVersion: await latestVersion(prisma, appointmentId), revision: 1, body: nextBody, idempotencyKey },
        update: { revision: revision + 1, body: nextBody, idempotencyKey, authorUserId: user.id },
      });
      await writeAudit(prisma, user.id, "encounter.draft", `Saved a draft for ${appointment.reference}`, { type: "appointment", id: appointmentId });
      return { revision: saved.revision, fields: nextBody, duplicate: false };
    },

    async sign(userId: string, appointmentId: string, body: unknown) {
      const input = z.object({
        baseVersion: z.number().int().nonnegative(),
        idempotencyKey: z.string().min(8),
        sharedWithPatient: z.boolean().optional(),
      }).and(encounterBodySchema).parse(body);
      const user = await requireUser(prisma, userId);
      const appointment = await ownedVisit(prisma, user, appointmentId);
      if (appointment.paymentStatus !== "verified") throw forbidden("Payment has not been verified.");
      const replay = await prisma.encounter.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (replay) return { id: replay.id, version: replay.version, reportReference: replay.reportReference, duplicate: true };
      const { baseVersion, idempotencyKey, ...raw } = input;
      const encounterBody = normalizeEncounterBody(raw as Partial<EncounterBody>);
      const validation = validateEncounter(encounterBody);
      if (validation) throw badRequest(validation);
      const latest = await prisma.encounter.findFirst({ where: { appointmentId }, orderBy: { version: "desc" } });
      if ((latest?.version ?? 0) !== baseVersion) throw conflict("The signed consultation changed. Review the latest version before signing again.");
      if (latest && changedEncounterFields(normalizeEncounterBody(latest.body as Partial<EncounterBody>), encounterBody).length === 0) {
        throw conflict("Change the consultation before signing an amendment.");
      }
      const reportReference = latest?.reportReference || consultationReportReference(appointment.reference);
      const created = await prisma.$transaction(async (tx) => {
        const encounter = await tx.encounter.create({
          data: {
            appointmentId,
            patientUserId: appointment.patientUserId,
            consultantSlug: appointment.consultantSlug,
            authorUserId: user.id,
            version: baseVersion + 1,
            supersedesId: latest?.id,
            idempotencyKey,
            reportReference,
            body: encounterBody,
            signedAt: new Date(),
          },
        });
        await tx.encounterDraft.deleteMany({ where: { appointmentId } });
        await tx.appointment.update({ where: { id: appointmentId }, data: { status: "completed" } });
        await tx.clinicalRecord.create({
          data: {
            appointmentId,
            patientUserId: appointment.patientUserId,
            consultantSlug: appointment.consultantSlug,
            notes: encounterBody.chiefComplaint,
            diagnosis: encounterBody.diagnoses.map((item) => item.name).join("; "),
            treatment: encounterBody.plan,
            prescription: encounterBody.prescriptionStatus === "prescribed" ? encounterBody.medications.map((item) => item.name).join("; ") : "",
            sharedWithPatient: encounterBody.sharedWithPatient,
          },
        });
        await syncSigned(tx, encounter.id, encounterBody, appointment, user.id, `${user.firstName} ${user.lastName}`);
        await writeAudit(tx, user.id, "encounter.sign", `Signed version ${encounter.version} of ${appointment.reference}`, { type: "encounter", id: encounter.id });
        return encounter;
      });
      return { id: created.id, version: created.version, reportReference: created.reportReference, duplicate: false };
    },

    async read(userId: string, appointmentId: string) {
      const user = await requireUser(prisma, userId);
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment || !canSeeAppointment(user, appointment)) throw notFound("That appointment was not found.");
      const rows = await prisma.encounter.findMany({ where: { appointmentId }, orderBy: { version: "desc" } });
      const draft = user.role === "consultant" ? await prisma.encounterDraft.findUnique({ where: { appointmentId } }) : null;
      if (user.role === "administrator") {
        return { versions: rows.map((row) => ({ id: row.id, version: row.version, status: row.status, signedAt: row.signedAt })), draft: null };
      }
      if (user.role === "patient") {
        const shared = rows.filter((row) => normalizeEncounterBody(row.body as Partial<EncounterBody>).sharedWithPatient);
        const latest = shared[0];
        return { versions: latest ? [publicEncounter(latest)] : [], draft: null };
      }
      return { versions: rows.map((row) => publicEncounter(row)), draft: draft ? publicDraft(draft) : null };
    },

    async report(userId: string, appointmentId: string) {
      const user = await requireUser(prisma, userId);
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment || !canSeeAppointment(user, appointment)) throw notFound("That appointment was not found.");
      const rows = await prisma.encounter.findMany({ where: { appointmentId }, orderBy: { version: "desc" } });
      const visible = user.role === "patient" ? rows.find((row) => normalizeEncounterBody(row.body as Partial<EncounterBody>).sharedWithPatient) : rows[0];
      if (!visible || user.role === "administrator") throw notFound("That consultation summary is not available.");
      const patient = await prisma.user.findUnique({ where: { id: appointment.patientUserId } });
      const consultant = await prisma.user.findFirst({ where: { consultantSlug: appointment.consultantSlug } });
      const department = appointment.departmentSlug ? await prisma.department.findUnique({ where: { slug: appointment.departmentSlug } }) : null;
      return buildConsultationReport({
        body: normalizeEncounterBody(visible.body as Partial<EncounterBody>),
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Patient",
        patientNumber: patient?.patientNumber ?? "",
        consultantName: consultant ? `${consultant.firstName} ${consultant.lastName}` : appointment.consultantSlug,
        departmentName: department?.name ?? appointment.departmentSlug,
        consultationType: appointment.consultationType,
        startsAt: appointment.startsAt.toISOString(),
        durationMinutes: appointment.durationMinutes,
        appointmentReference: appointment.reference,
        signedAt: visible.signedAt.toISOString(),
        version: visible.version,
        reportReference: visible.reportReference || consultationReportReference(appointment.reference),
      });
    },

    async handoff(userId: string, encounterId: string, audience: string) {
      if (!["pharmacy", "imaging", "referral", "admission"].includes(audience)) throw badRequest("Choose pharmacy, imaging, referral, or admission.");
      const user = await requireUser(prisma, userId);
      const encounter = await prisma.encounter.findUnique({ where: { id: encounterId } });
      if (!encounter) throw notFound("That consultation was not found.");
      const body = normalizeEncounterBody(encounter.body as Partial<EncounterBody>);
      const appointment = await prisma.appointment.findUnique({ where: { id: encounter.appointmentId } });
      if (!appointment) throw notFound("That consultation was not found.");
      const allowed = canSeeAppointment(user, appointment) || (user.role === "pharmacist" && audience === "pharmacy") || (user.role === "laboratory_officer" && audience === "imaging") || (user.role === "patient" && body.sharedWithPatient);
      if (!allowed) throw forbidden("You cannot open this card.");
      if (user.role === "patient" && !body.sharedWithPatient) throw forbidden("This consultation has not been shared.");
      const patient = await prisma.user.findUnique({ where: { id: encounter.patientUserId } });
      const consultant = await prisma.user.findFirst({ where: { consultantSlug: encounter.consultantSlug } });
      const card = buildHandoff(body, {
        audience,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Patient",
        patientNumber: patient?.patientNumber ?? "",
        reference: appointment.reference,
        consultantName: consultant ? `${consultant.firstName} ${consultant.lastName}` : encounter.consultantSlug,
        version: encounter.version,
        signed: true,
      });
      return card;
    },

    async demoEmail(userId: string, encounterId: string) {
      const user = await requireUser(prisma, userId);
      const encounter = await prisma.encounter.findUnique({ where: { id: encounterId } });
      if (!encounter) throw notFound("That consultation was not found.");
      const body = normalizeEncounterBody(encounter.body as Partial<EncounterBody>);
      const appointment = await prisma.appointment.findUnique({ where: { id: encounter.appointmentId } });
      if (!appointment || !canSeeAppointment(user, appointment)) throw notFound("That consultation was not found.");
      if (user.role === "patient" && (!body.sharedWithPatient || user.id !== appointment.patientUserId)) throw forbidden("This summary is not available.");
      const patient = await prisma.user.findUnique({ where: { id: appointment.patientUserId } });
      let delivered = false;
      if (patient) {
        const result = await mailer.send({ to: patient.email, subject: `Consultation summary ${appointment.reference}`, text: "Your consultation summary is ready in the patient portal." });
        delivered = result.delivered;
      }
      await notifyUser(prisma, appointment.patientUserId, "Consultation summary", "Your consultation summary is ready in the portal.", `/patient/records/${appointment.id}`);
      await writeAudit(prisma, user.id, "encounter.email", `Summary notice for ${appointment.reference}`, { type: "encounter", id: encounterId });
      return { delivered, message: delivered ? "The email provider accepted the message." : "The summary is ready in the portal. An email provider has not accepted a message." };
    },

    async addAllergy(userId: string, patientId: string, body: unknown) {
      const input = z.object({ substance: z.string().trim().min(1), reaction: z.string().optional() }).parse(body);
      const user = await requireUser(prisma, userId);
      if (user.role === "patient" && user.id !== patientId) throw forbidden("You can only update your own allergy history.");
      if (user.role === "consultant") {
        const linked = await prisma.appointment.findFirst({ where: { patientUserId: patientId, OR: [{ consultantSlug: user.consultantSlug ?? "" }, { consultantSlug: SUPER_CONSULTANT_SLUG }] } });
        if (user.consultantSlug !== SUPER_CONSULTANT_SLUG && !linked) throw forbidden("You do not have a visit for this patient.");
      } else if (user.role !== "patient") throw forbidden("You cannot add an allergy here.");
      const created = await prisma.allergy.create({
        data: { patientUserId: patientId, substance: input.substance, reaction: input.reaction?.trim() ?? "", recordedByUserId: user.id, source: user.role === "patient" ? "patient" : "consultant" },
      });
      await writeAudit(prisma, user.id, "patient.allergy", `Recorded an allergy for ${patientId}`, { type: "allergy", id: created.id });
      return publicAllergy(created);
    },

    async listAllergies(userId: string, patientId: string) {
      const user = await requireUser(prisma, userId);
      if (user.role === "patient" && user.id !== patientId) throw forbidden("You can only read your own allergy history.");
      return (await prisma.allergy.findMany({ where: { patientUserId: patientId }, orderBy: { recordedAt: "desc" } })).map(publicAllergy);
    },

    async saveRecord(userId: string, appointmentId: string, body: unknown) {
      const input = z.object({
        notes: z.string().default(""),
        diagnosis: z.string().default(""),
        treatment: z.string().default(""),
        prescription: z.string().default(""),
        sharedWithPatient: z.boolean().default(false),
      }).parse(body);
      const user = await requireUser(prisma, userId);
      const appointment = await ownedVisit(prisma, user, appointmentId);
      const created = await prisma.clinicalRecord.create({
        data: { appointmentId, patientUserId: appointment.patientUserId, consultantSlug: appointment.consultantSlug, ...input },
      });
      await writeAudit(prisma, user.id, "record.save", `Saved a note for ${appointment.reference}`, { type: "record", id: created.id });
      return publicRecord(created);
    },

    async patientRecords(userId: string, patientId: string) {
      const user = await requireUser(prisma, userId);
      if (user.role === "administrator") return [];
      if (user.role === "patient" && user.id !== patientId) throw forbidden("You can only read your own notes.");
      const where = user.role === "patient"
        ? { patientUserId: patientId, sharedWithPatient: true }
        : { patientUserId: patientId, consultantSlug: user.consultantSlug === SUPER_CONSULTANT_SLUG ? undefined : user.consultantSlug ?? "none" };
      return (await prisma.clinicalRecord.findMany({ where, orderBy: { createdAt: "desc" } })).map((row) => publicRecord(row));
    },

    async upload(userId: string, file: Express.Multer.File | undefined, fields: { appointmentId?: string; sharedWithPatient?: string }) {
      if (!file) throw badRequest("Choose a JPG, PNG, or PDF.");
      const allowed = ["image/jpeg", "image/png", "application/pdf"];
      if (!allowed.includes(file.mimetype)) throw new (await import("../lib/errors")).ApiError(415, "unsupported_media", "Upload a JPG, PNG, or PDF.");
      if (file.size > 400_000) throw new (await import("../lib/errors")).ApiError(413, "payload_too_large", "The file must be 400 KB or smaller.");
      const user = await requireUser(prisma, userId);
      const appointment = fields.appointmentId ? await prisma.appointment.findUnique({ where: { id: fields.appointmentId } }) : null;
      if (fields.appointmentId && (!appointment || !canSeeAppointment(user, appointment))) throw notFound("That appointment was not found.");
      const ownerUserId = appointment?.patientUserId ?? user.id;
      if (user.role === "patient" && ownerUserId !== user.id) throw forbidden("You cannot upload for another patient.");
      const stored = await storage.put({ bytes: file.buffer, mimeType: file.mimetype, name: file.originalname });
      const created = await prisma.document.create({
        data: {
          ownerUserId,
          appointmentId: appointment?.id,
          uploadedByUserId: user.id,
          name: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          bytes: Uint8Array.from(stored.bytes),
          sharedWithPatient: fields.sharedWithPatient === "true" || user.role === "patient",
        },
      });
      await writeAudit(prisma, user.id, "document.upload", `Uploaded ${created.name}`, { type: "document", id: created.id });
      return { id: created.id };
    },

    async listDocuments(userId: string) {
      const user = await requireUser(prisma, userId);
      const where = user.role === "patient"
        ? { OR: [{ ownerUserId: user.id }, { sharedWithPatient: true, ownerUserId: user.id }] }
        : user.role === "consultant"
          ? {}
          : { uploadedByUserId: user.id };
      const rows = await prisma.document.findMany({ where, orderBy: { uploadedAt: "desc" }, take: 100 });
      const visible = user.role === "consultant" && user.consultantSlug !== SUPER_CONSULTANT_SLUG
        ? rows.filter((row) => row.uploadedByUserId === user.id)
        : rows;
      return visible.map((row) => publicDocument(row, false));
    },
  };
}

async function ownedVisit(prisma: PrismaClient, user: { id: string; role: string; consultantSlug: string | null }, appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound("That appointment was not found.");
  if (user.role !== "consultant") throw forbidden("Only the assigned consultant can write this consultation.");
  if (user.consultantSlug !== appointment.consultantSlug && user.consultantSlug !== SUPER_CONSULTANT_SLUG) throw forbidden("This visit is not assigned to you.");
  return appointment;
}

async function latestVersion(prisma: PrismaClient, appointmentId: string) {
  const latest = await prisma.encounter.findFirst({ where: { appointmentId }, orderBy: { version: "desc" } });
  return latest?.version ?? 0;
}

async function syncSigned(tx: Prisma.TransactionClient, encounterId: string, body: EncounterBody, appointment: { id: string; reference: string; patientUserId: string; consultantSlug: string; departmentSlug: string }, actorId: string, actorName: string) {
  let journey = await tx.journey.findFirst({ where: { appointmentId: appointment.id } });
  const desired = body.prescriptionStatus === "prescribed" && body.medications.length > 0 ? "awaiting_pharmacy" : body.investigations.length || body.imaging.length ? "awaiting_investigation" : "completed";
  if (!journey) {
    const year = lagosCalendarYear();
    const seq = await nextCounter(tx, `enc-${year}`);
    journey = await tx.journey.create({
      data: {
        reference: reference("OOUTH-ENC", year, seq),
        appointmentId: appointment.id,
        patientUserId: appointment.patientUserId,
        departmentSlug: appointment.departmentSlug,
        consultantSlug: appointment.consultantSlug,
        queueStatus: desired,
        registeredByUserId: actorId,
      },
    });
  } else {
    journey = await tx.journey.update({ where: { id: journey.id }, data: { queueStatus: desired } });
  }
  await tx.journeyEvent.create({
    data: { journeyId: journey.id, appointmentId: appointment.id, type: "consultation_signed", actorId, actorName, departmentSlug: appointment.departmentSlug, status: desired, relatedReference: encounterId },
  });
  const rx = prescriptionReference(appointment.reference);
  if (body.prescriptionStatus === "prescribed") {
    let index = 0;
    for (const medication of body.medications) {
      index += 1;
      const existing = await tx.dispense.findFirst({ where: { appointmentId: appointment.id, medicationItemId: String(medication.id ?? `${index}`) } });
      if (existing) continue;
      const year = lagosCalendarYear();
      const seq = await nextCounter(tx, `dsp-${year}`);
      const created = await tx.dispense.create({
        data: {
          reference: reference("OOUTH-RX", year, seq),
          prescriptionReference: rx,
          appointmentId: appointment.id,
          encounterId,
          patientUserId: appointment.patientUserId,
          consultantSlug: appointment.consultantSlug,
          departmentSlug: appointment.departmentSlug,
          medicationItemId: String(medication.id ?? index),
          medicationName: String(medication.name ?? ""),
          strength: String(medication.strength ?? ""),
          dose: String(medication.dose ?? ""),
          route: String(medication.route ?? ""),
          frequency: String(medication.frequency ?? ""),
          duration: String(medication.duration ?? ""),
          instructions: String(medication.instructions ?? ""),
          status: "pending_pharmacy",
          verificationCode: reference("VER", year, seq).slice(-8),
        },
      });
      await tx.journeyEvent.create({
        data: { journeyId: journey.id, appointmentId: appointment.id, type: "prescription_created", actorId, actorName, departmentSlug: appointment.departmentSlug, status: "pending_pharmacy", relatedReference: created.reference },
      });
    }
  }
  for (const test of [...body.investigations.map((item) => ({ kind: "laboratory", item })), ...body.imaging.map((item) => ({ kind: "imaging", item }))]) {
    const sourceItemId = String(test.item.id ?? test.item.name);
    const existing = await tx.investigationOrder.findFirst({ where: { appointmentId: appointment.id, sourceItemId } });
    if (existing) continue;
    const year = lagosCalendarYear();
    const seq = await nextCounter(tx, `inv-${year}`);
    const created = await tx.investigationOrder.create({
      data: {
        reference: reference("OOUTH-INV", year, seq),
        appointmentId: appointment.id,
        encounterId,
        patientUserId: appointment.patientUserId,
        consultantSlug: appointment.consultantSlug,
        departmentSlug: appointment.departmentSlug,
        sourceItemId,
        kind: test.kind,
        name: String(test.item.name ?? ""),
        indication: String(test.item.reason ?? test.item.indication ?? ""),
        priority: String(test.item.priority ?? "routine"),
        preparation: String(test.item.preparation ?? ""),
        status: "requested",
        verificationCode: reference("VER", year, seq).slice(-8),
      },
    });
    await tx.journeyEvent.create({
      data: { journeyId: journey.id, appointmentId: appointment.id, type: "investigation_requested", actorId, actorName, departmentSlug: appointment.departmentSlug, status: "requested", relatedReference: created.reference },
    });
  }
}
