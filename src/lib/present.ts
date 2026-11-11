import type { Allergy, Appointment, AuditEvent, Availability, ClinicalRecord, Department, DeskPayment, Dispense, Document, Encounter, EncounterDraft, HospitalSettings, InvestigationOrder, Journey, JourneyEvent, Notification, Observation, ObservationOrder, Rating, User } from "@prisma/client";
import type { Admission, Bed, Handover, InventoryItem, MedicationAdministration, NursingTask, Shift, Ward } from "@prisma/client";
import { normalizeEncounterBody, type EncounterBody } from "../domain/clinical";

export function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : undefined;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth ?? undefined,
    gender: user.gender ?? undefined,
    address: user.address ?? undefined,
    patientNumber: user.patientNumber ?? undefined,
    consultantSlug: user.consultantSlug ?? undefined,
    staffId: user.staffId ?? undefined,
    departmentSlug: user.departmentSlug ?? undefined,
    designation: user.designation ?? undefined,
    specialty: user.specialty ?? undefined,
    note: user.consultantNote ?? undefined,
    onlineBookingEnabled: user.onlineBookingEnabled,
    emergencyContactName: user.emergencyContactName ?? undefined,
    emergencyContactPhone: user.emergencyContactPhone ?? undefined,
    active: user.active,
    registrationPaidYear: user.registrationPaidYear,
    allergyStatus: user.allergyStatus ?? undefined,
    preview: user.preview,
    createdAt: user.createdAt.toISOString(),
  };
}

export function publicAppointment(row: Appointment) {
  return {
    id: row.id,
    reference: row.reference,
    patientUserId: row.patientUserId,
    consultantSlug: row.consultantSlug,
    departmentSlug: row.departmentSlug,
    consultationType: row.consultationType,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    symptoms: row.symptoms,
    medicalHistory: row.medicalHistory,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentReference: row.paymentReference,
    amountNaira: row.amountNaira,
    consultationFeeNaira: row.consultationFeeNaira,
    registrationFeeNaira: row.registrationFeeNaira,
    durationMinutes: row.durationMinutes,
    privacyConsent: row.privacyConsent,
    telemedicineConsent: row.telemedicineConsent,
    suggestedDepartmentSlugs: (row.suggestedDepartmentSlugs as string[]) ?? [],
    patientInRoom: row.patientInRoom,
    consultantInRoom: row.consultantInRoom,
    pendingStartsAt: iso(row.pendingStartsAt),
    pendingEndsAt: iso(row.pendingEndsAt),
    rescheduleFeeNaira: row.rescheduleFeeNaira,
    bookingSource: row.bookingSource,
    durationHours: row.durationHours === 1 || row.durationHours === 2 ? row.durationHours : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelReason: row.cancelReason ?? undefined,
  };
}

export function publicEncounter(row: Encounter, stripNarrative = false) {
  const body = stripNarrative ? normalizeEncounterBody() : normalizeEncounterBody(row.body as Partial<EncounterBody>);
  return {
    ...body,
    id: row.id,
    appointmentId: row.appointmentId,
    patientUserId: row.patientUserId,
    consultantSlug: row.consultantSlug,
    authorUserId: row.authorUserId,
    version: row.version,
    status: "signed" as const,
    supersedesId: row.supersedesId ?? undefined,
    idempotencyKey: row.idempotencyKey,
    reportReference: row.reportReference ?? undefined,
    signedAt: row.signedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicDraft(row: EncounterDraft) {
  return {
    appointmentId: row.appointmentId,
    baseVersion: row.baseVersion,
    revision: row.revision,
    body: normalizeEncounterBody(row.body as Partial<EncounterBody>),
    updatedAt: row.updatedAt.toISOString(),
    idempotencyKey: row.idempotencyKey,
  };
}

export function publicRecord(row: ClinicalRecord, strip = false) {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    patientUserId: row.patientUserId,
    consultantSlug: row.consultantSlug,
    notes: strip ? "" : row.notes,
    diagnosis: strip ? "" : row.diagnosis,
    treatment: strip ? "" : row.treatment,
    prescription: strip ? "" : row.prescription,
    sharedWithPatient: row.sharedWithPatient,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicDocument(row: Document, includeBytes: boolean) {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    appointmentId: row.appointmentId ?? undefined,
    uploadedByUserId: row.uploadedByUserId,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    dataUrl: includeBytes ? `data:${row.mimeType};base64,${Buffer.from(row.bytes).toString("base64")}` : "",
    uploadedAt: row.uploadedAt.toISOString(),
    sharedWithPatient: row.sharedWithPatient,
  };
}

export function publicAllergy(row: Allergy) {
  return {
    id: row.id,
    patientUserId: row.patientUserId,
    substance: row.substance,
    reaction: row.reaction || undefined,
    recordedByUserId: row.recordedByUserId,
    recordedAt: row.recordedAt.toISOString(),
    source: row.source,
  };
}

export function publicAvailability(row: Availability) {
  return {
    consultantSlug: row.consultantSlug,
    days: row.days as number[],
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    breaks: row.breaks as Array<{ start: string; end: string }>,
    blockedDates: row.blockedDates as string[],
    physicalEnabled: row.physicalEnabled,
    virtualEnabled: row.virtualEnabled,
    provisional: row.provisional,
  };
}

export function publicDepartment(row: Department) {
  return { id: row.id, slug: row.slug, name: row.name, group: row.group, summary: row.summary, body: row.body, patientBooking: row.patientBooking };
}

export function feesFrom(row: HospitalSettings) {
  return { consultationPerHourNaira: row.consultationPerHourNaira, registrationFeeNaira: row.registrationFeeNaira, defaultDurationMinutes: row.defaultDurationMinutes };
}

export function policiesFrom(row: HospitalSettings) {
  return { cancellationNoticeHours: row.cancellationNoticeHours, rescheduleNoticeHours: row.rescheduleNoticeHours, joinMinutesBefore: row.joinMinutesBefore, joinMinutesAfter: row.joinMinutesAfter };
}

export function publicNotification(row: Notification) {
  return { id: row.id, userId: row.userId, title: row.title, body: row.body, createdAt: row.createdAt.toISOString(), read: row.read, href: row.href ?? undefined };
}

export function publicAudit(row: AuditEvent) {
  return { id: row.id, at: row.at.toISOString(), actorId: row.actorId, action: row.action, summary: row.summary };
}

export function publicJourney(row: Journey) {
  return {
    id: row.id, reference: row.reference, appointmentId: row.appointmentId, patientUserId: row.patientUserId,
    departmentSlug: row.departmentSlug, consultantSlug: row.consultantSlug, queueStatus: row.queueStatus,
    registeredByUserId: row.registeredByUserId, arrivedAt: iso(row.arrivedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicJourneyEvent(row: JourneyEvent) {
  return {
    id: row.id, journeyId: row.journeyId, appointmentId: row.appointmentId, type: row.type, at: row.at.toISOString(),
    actorId: row.actorId, actorName: row.actorName, departmentSlug: row.departmentSlug, status: row.status, relatedReference: row.relatedReference,
  };
}

export function publicDispense(row: Dispense) {
  return {
    ...row,
    collectedAt: iso(row.collectedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicOrder(row: InvestigationOrder) {
  return { ...row, collectedAt: iso(row.collectedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export function publicDeskPayment(row: DeskPayment) {
  return { ...row, paidAt: iso(row.paidAt), createdAt: row.createdAt.toISOString() };
}

export function publicObservation(row: Observation) {
  return { ...row, recordedAt: row.recordedAt.toISOString(), nextDueAt: iso(row.nextDueAt), readings: row.readings };
}

export function publicObservationOrder(row: ObservationOrder) {
  return { ...row, assignedAt: row.assignedAt.toISOString(), startAt: row.startAt.toISOString(), endAt: iso(row.endAt) };
}

export function publicAdministration(row: MedicationAdministration) {
  return { ...row, recordedAt: row.recordedAt.toISOString() };
}

export function publicTask(row: NursingTask) {
  return { ...row, dueAt: row.dueAt.toISOString(), createdAt: row.createdAt.toISOString(), sourceKey: row.sourceKey ?? undefined };
}

export function publicShift(row: Shift) {
  return { ...row, startedAt: row.startedAt.toISOString(), endedAt: iso(row.endedAt) };
}

export function publicHandover(row: Handover) {
  return { ...row, acknowledgedAt: iso(row.acknowledgedAt), createdAt: row.createdAt.toISOString() };
}

export function publicAdmission(row: Admission) {
  return { ...row, admittedAt: row.admittedAt.toISOString() };
}

export function publicInventory(row: InventoryItem) {
  return { id: row.id, name: row.name, category: row.category, quantity: row.quantity, unit: row.unit, reorderLevel: row.reorderLevel, updatedAt: row.updatedAt.toISOString() };
}

export function publicRating(row: Rating) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export function publicWard(row: Ward) {
  return row;
}

export function publicBed(row: Bed) {
  return { id: row.id, wardId: row.wardId, label: row.label, patientUserId: row.patientUserId ?? undefined };
}
