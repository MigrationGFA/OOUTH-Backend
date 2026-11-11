import type { PrismaClient, User } from "@prisma/client";
import { normalizeEncounterBody, type EncounterBody } from "../domain/clinical";
import {
  feesFrom, policiesFrom, publicAdmission, publicAdministration, publicAllergy, publicAppointment, publicAudit, publicAvailability, publicBed, publicDepartment, publicDeskPayment, publicDispense, publicDocument, publicEncounter, publicHandover, publicInventory, publicJourney, publicJourneyEvent, publicNotification, publicObservation, publicObservationOrder, publicOrder, publicRating, publicRecord, publicShift, publicTask, publicUser, publicWard,
} from "../lib/present";
import { requireUser, SUPER_CONSULTANT_SLUG } from "./shared";

export function createWorkspaceService(prisma: PrismaClient) {
  return {
    async snapshot(userId: string) {
      const actor = await requireUser(prisma, userId);
      const settings = await prisma.hospitalSettings.findUnique({ where: { id: "default" } });
      if (!settings) throw new Error("Hospital settings are missing.");
      const departments = await prisma.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
      const availability = await prisma.availability.findMany();
      const consultants = await prisma.user.findMany({ where: { role: "consultant", deletedAt: null } });
      const consultantBooking = Object.fromEntries(consultants.map((item) => [item.consultantSlug ?? "", item.onlineBookingEnabled]));
      const appointments = await visibleAppointments(prisma, actor);
      const appointmentIds = appointments.map((item) => item.id);
      const patientIds = [...new Set(appointments.map((item) => item.patientUserId))];
      const users = await visibleUsers(prisma, actor, patientIds, consultants);
      const encounters = await visibleEncounters(prisma, actor, appointmentIds);
      const records = await visibleRecords(prisma, actor, appointmentIds);
      const documents = await visibleDocuments(prisma, actor, appointmentIds);
      const allergies = await prisma.allergy.findMany({ where: actor.role === "patient" ? { patientUserId: actor.id } : { patientUserId: { in: patientIds } } });
      const notifications = await prisma.notification.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "desc" }, take: 50 });
      const audit = actor.role === "administrator" ? await prisma.auditEvent.findMany({ orderBy: { at: "desc" }, take: 100 }) : [];
      const operational = await operationalSlice(prisma, actor, appointmentIds, patientIds);
      return {
        users: users.map(publicUser),
        sessionUserId: actor.id,
        appointments: appointments.map((item) => actor.role === "administrator" ? { ...publicAppointment(item), medicalHistory: "" } : publicAppointment(item)),
        records: records.map((item) => publicRecord(item, actor.role === "administrator")),
        encounters: encounters.map((item) => publicEncounter(item, actor.role === "administrator")),
        documents: documents.map((item) => publicDocument(item, true)),
        allergies: allergies.map(publicAllergy),
        notifications: notifications.map(publicNotification),
        audit: audit.map(publicAudit),
        availability: availability.map(publicAvailability),
        fees: feesFrom(settings),
        policies: policiesFrom(settings),
        consultantBooking,
        departments: departments.map(publicDepartment),
        ...operational,
      };
    },
  };
}

async function visibleAppointments(prisma: PrismaClient, actor: User) {
  if (actor.role === "patient") return prisma.appointment.findMany({ where: { patientUserId: actor.id }, orderBy: { startsAt: "desc" } });
  if (actor.role === "consultant" && actor.consultantSlug !== SUPER_CONSULTANT_SLUG) {
    return prisma.appointment.findMany({ where: { consultantSlug: actor.consultantSlug ?? "" }, orderBy: { startsAt: "desc" } });
  }
  if (["administrator", "desk_officer", "consultant", "nurse"].includes(actor.role)) return prisma.appointment.findMany({ orderBy: { startsAt: "desc" }, take: 300 });
  if (actor.role === "pharmacist" || actor.role === "laboratory_officer") return prisma.appointment.findMany({ orderBy: { startsAt: "desc" }, take: 200 });
  return [];
}

async function visibleUsers(prisma: PrismaClient, actor: User, patientIds: string[], consultants: User[]) {
  if (actor.role === "administrator" || actor.role === "desk_officer") {
    return prisma.user.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 500 });
  }
  const ids = new Set<string>([actor.id, ...patientIds, ...consultants.map((item) => item.id)]);
  return prisma.user.findMany({ where: { id: { in: [...ids] } } });
}

async function visibleEncounters(prisma: PrismaClient, actor: User, appointmentIds: string[]) {
  if (actor.role === "pharmacist" || actor.role === "laboratory_officer") return [];
  const rows = await prisma.encounter.findMany({ where: { appointmentId: { in: appointmentIds } }, orderBy: { version: "desc" } });
  if (actor.role === "patient") return rows.filter((row) => normalizeEncounterBody(row.body as Partial<EncounterBody>).sharedWithPatient);
  return rows;
}

async function visibleRecords(prisma: PrismaClient, actor: User, appointmentIds: string[]) {
  if (actor.role === "administrator" || actor.role === "pharmacist" || actor.role === "laboratory_officer") return [];
  const rows = await prisma.clinicalRecord.findMany({ where: { appointmentId: { in: appointmentIds } } });
  if (actor.role === "patient") return rows.filter((row) => row.sharedWithPatient);
  return rows;
}

async function visibleDocuments(prisma: PrismaClient, actor: User, appointmentIds: string[]) {
  if (actor.role === "patient") return prisma.document.findMany({ where: { OR: [{ ownerUserId: actor.id }, { sharedWithPatient: true, appointmentId: { in: appointmentIds } }] } });
  if (actor.role === "administrator") return prisma.document.findMany({ take: 100 });
  return prisma.document.findMany({ where: { appointmentId: { in: appointmentIds } } });
}

async function operationalSlice(prisma: PrismaClient, actor: User, appointmentIds: string[], patientIds: string[]) {
  const empty = {
    journeys: [], journeyEvents: [], dispenseRecords: [], inventoryItems: [], investigationOrders: [], observations: [], observationOrders: [],
    deskPayments: [], medicationAdministrations: [], nursingTasks: [], shifts: [], handovers: [], admissions: [], wards: [], beds: [], ratings: [], operationalDepartments: [],
  };
  const clinical = ["consultant", "administrator", "desk_officer", "nurse", "pharmacist", "laboratory_officer"].includes(actor.role);
  if (!clinical && actor.role !== "patient") return empty;
  const journeys = await prisma.journey.findMany({ where: actor.role === "patient" ? { patientUserId: actor.id } : { appointmentId: { in: appointmentIds } } });
  const events = await prisma.journeyEvent.findMany({ where: { journeyId: { in: journeys.map((item) => item.id) } }, orderBy: { at: "desc" }, take: 400 });
  const showDispense = ["pharmacist", "consultant", "administrator", "desk_officer", "nurse"].includes(actor.role);
  const showOrders = ["laboratory_officer", "consultant", "administrator", "desk_officer", "nurse"].includes(actor.role);
  const showNursing = actor.role === "nurse" || actor.role === "consultant" || actor.role === "administrator";
  const dispenses = showDispense ? await prisma.dispense.findMany({ where: actor.role === "pharmacist" ? {} : { appointmentId: { in: appointmentIds } }, take: 300 }) : [];
  const orders = showOrders || actor.role === "patient" ? await prisma.investigationOrder.findMany({ where: actor.role === "patient" ? { patientUserId: actor.id, releasedToPatient: true } : actor.role === "laboratory_officer" ? {} : { appointmentId: { in: appointmentIds } }, take: 300 }) : [];
  const inventory = actor.role === "pharmacist" || actor.role === "administrator" ? await prisma.inventoryItem.findMany({ where: { deletedAt: null } }) : [];
  const observations = showNursing ? await prisma.observation.findMany({ where: { patientUserId: { in: patientIds.length ? patientIds : ["none"] } }, take: 300 }) : [];
  const observationOrders = showNursing ? await prisma.observationOrder.findMany() : [];
  const deskPayments = actor.role === "desk_officer" || actor.role === "administrator" ? await prisma.deskPayment.findMany({ take: 200, orderBy: { createdAt: "desc" } }) : [];
  const administrations = showNursing ? await prisma.medicationAdministration.findMany({ take: 300 }) : [];
  const tasks = actor.role === "nurse" ? await prisma.nursingTask.findMany({ take: 300 }) : [];
  const shifts = actor.role === "nurse" ? await prisma.shift.findMany({ where: { nurseUserId: actor.id } }) : [];
  const handovers = actor.role === "nurse" ? await prisma.handover.findMany({ take: 100 }) : [];
  const admissions = showNursing ? await prisma.admission.findMany() : [];
  const wards = showNursing || actor.role === "desk_officer" ? await prisma.ward.findMany() : [];
  const beds = wards.length ? await prisma.bed.findMany() : [];
  const ratings = actor.role === "patient"
    ? await prisma.rating.findMany({ where: { patientUserId: actor.id } })
    : actor.role === "administrator" || actor.role === "consultant"
      ? await prisma.rating.findMany({ where: actor.role === "consultant" && actor.consultantSlug !== SUPER_CONSULTANT_SLUG ? { consultantSlug: actor.consultantSlug ?? "" } : {} })
      : [];
  const operationalDepartments = await prisma.department.findMany({ where: { operational: true, deletedAt: null } });
  return {
    journeys: journeys.map(publicJourney),
    journeyEvents: events.map(publicJourneyEvent),
    dispenseRecords: dispenses.map(publicDispense),
    inventoryItems: inventory.map(publicInventory),
    investigationOrders: orders.map(publicOrder),
    observations: observations.map(publicObservation),
    observationOrders: observationOrders.map(publicObservationOrder),
    deskPayments: deskPayments.map(publicDeskPayment),
    medicationAdministrations: administrations.map(publicAdministration),
    nursingTasks: tasks.map(publicTask),
    shifts: shifts.map(publicShift),
    handovers: handovers.map(publicHandover),
    admissions: admissions.map(publicAdmission),
    wards: wards.map(publicWard),
    beds: beds.map(publicBed),
    ratings: ratings.map(publicRating),
    operationalDepartments: operationalDepartments.map((item) => ({ id: item.id, slug: item.slug, name: item.name })),
  };
}
