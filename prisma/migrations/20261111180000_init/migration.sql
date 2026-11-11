-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "dateOfBirth" TEXT,
    "gender" TEXT,
    "address" TEXT,
    "patientNumber" TEXT,
    "consultantSlug" TEXT,
    "staffId" TEXT,
    "departmentSlug" TEXT,
    "designation" TEXT,
    "specialty" TEXT,
    "consultantNote" TEXT,
    "onlineBookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "registrationPaidYear" INTEGER,
    "allergyStatus" TEXT,
    "preview" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "patientBooking" BOOLEAN NOT NULL DEFAULT false,
    "operational" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "consultantSlug" TEXT NOT NULL,
    "days" JSONB NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "breaks" JSONB NOT NULL,
    "blockedDates" JSONB NOT NULL,
    "physicalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "virtualEnabled" BOOLEAN NOT NULL DEFAULT true,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("consultantSlug")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "departmentSlug" TEXT NOT NULL DEFAULT '',
    "consultationType" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "symptoms" TEXT NOT NULL DEFAULT '',
    "medicalHistory" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL DEFAULT '',
    "amountNaira" INTEGER NOT NULL DEFAULT 0,
    "consultationFeeNaira" INTEGER NOT NULL DEFAULT 0,
    "registrationFeeNaira" INTEGER NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "privacyConsent" BOOLEAN NOT NULL,
    "telemedicineConsent" BOOLEAN NOT NULL DEFAULT false,
    "suggestedDepartmentSlugs" JSONB NOT NULL,
    "patientInRoom" BOOLEAN NOT NULL DEFAULT false,
    "consultantInRoom" BOOLEAN NOT NULL DEFAULT false,
    "pendingStartsAt" TIMESTAMP(3),
    "pendingEndsAt" TIMESTAMP(3),
    "rescheduleFeeNaira" INTEGER NOT NULL DEFAULT 0,
    "bookingSource" TEXT NOT NULL DEFAULT 'online',
    "durationHours" INTEGER,
    "slotKey" TEXT,
    "pendingSlotKey" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amountNaira" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalRecord" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "prescription" TEXT NOT NULL,
    "sharedWithPatient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'signed',
    "supersedesId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "reportReference" TEXT,
    "body" JSONB NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterDraft" (
    "appointmentId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncounterDraft_pkey" PRIMARY KEY ("appointmentId")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sharedWithPatient" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "substance" TEXT NOT NULL,
    "reaction" TEXT NOT NULL DEFAULT '',
    "recordedByUserId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "departmentSlug" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "queueStatus" TEXT NOT NULL,
    "registeredByUserId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "departmentSlug" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "relatedReference" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispense" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "prescriptionReference" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "departmentSlug" TEXT NOT NULL,
    "medicationItemId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "strength" TEXT NOT NULL DEFAULT '',
    "dose" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL DEFAULT '',
    "frequency" TEXT NOT NULL DEFAULT '',
    "duration" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "quantityDispensed" INTEGER NOT NULL DEFAULT 0,
    "dispensingInstructions" TEXT NOT NULL DEFAULT '',
    "substitution" TEXT NOT NULL DEFAULT '',
    "clarification" TEXT NOT NULL DEFAULT '',
    "verificationCode" TEXT NOT NULL,
    "verifiedPatient" BOOLEAN NOT NULL DEFAULT false,
    "collectedAt" TIMESTAMP(3),
    "collectedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "reorderLevel" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "departmentSlug" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "indication" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'routine',
    "preparation" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "resultText" TEXT NOT NULL DEFAULT '',
    "resultFileName" TEXT NOT NULL DEFAULT '',
    "resultDataUrl" TEXT NOT NULL DEFAULT '',
    "performingOfficerUserId" TEXT NOT NULL DEFAULT '',
    "interpretation" TEXT NOT NULL DEFAULT '',
    "releasedToPatient" BOOLEAN NOT NULL DEFAULT false,
    "verificationCode" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3),
    "collectedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestigationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservationOrder" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "instructions" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ObservationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "nurseUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readings" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "behaviour" TEXT NOT NULL DEFAULT '',
    "risk" TEXT,
    "orderId" TEXT,
    "nextDueAt" TIMESTAMP(3),

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeskPayment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "consultantSlug" TEXT NOT NULL DEFAULT '',
    "departmentSlug" TEXT NOT NULL DEFAULT '',
    "durationHours" INTEGER NOT NULL,
    "registrationFeeNaira" INTEGER NOT NULL,
    "consultationFeeNaira" INTEGER NOT NULL,
    "totalNaira" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "amountReceived" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAdministration" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "medicationItemId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "scheduledFor" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nurseUserId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NursingTask" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "assignedNurseUserId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "completionNote" TEXT NOT NULL DEFAULT '',
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NursingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "nurseUserId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handover" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL DEFAULT '',
    "appointmentId" TEXT,
    "authorUserId" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT '',
    "observations" TEXT NOT NULL DEFAULT '',
    "medicationsGiven" TEXT NOT NULL DEFAULT '',
    "pendingMedication" TEXT NOT NULL DEFAULT '',
    "outstandingInvestigations" TEXT NOT NULL DEFAULT '',
    "pendingTasks" TEXT NOT NULL DEFAULT '',
    "changes" TEXT NOT NULL DEFAULT '',
    "issues" TEXT NOT NULL DEFAULT '',
    "generalSummary" TEXT NOT NULL DEFAULT '',
    "patientUpdates" TEXT NOT NULL DEFAULT '',
    "medicationUpdates" TEXT NOT NULL DEFAULT '',
    "observationUpdates" TEXT NOT NULL DEFAULT '',
    "pendingTasksNote" TEXT NOT NULL DEFAULT '',
    "clinicalConcerns" TEXT NOT NULL DEFAULT '',
    "nextInstructions" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amendsId" TEXT,
    "snapshot" TEXT NOT NULL DEFAULT '',
    "acknowledgedByUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bed" (
    "id" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "patientUserId" TEXT,

    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "wardId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "diagnosisLabel" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT '',
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dischargeStatus" TEXT NOT NULL DEFAULT 'admitted',

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "consultantSlug" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "communication" INTEGER NOT NULL,
    "professionalism" INTEGER NOT NULL,
    "attention" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL DEFAULT '',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "consultationPerHourNaira" INTEGER NOT NULL,
    "registrationFeeNaira" INTEGER NOT NULL,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "cancellationNoticeHours" INTEGER NOT NULL,
    "rescheduleNoticeHours" INTEGER NOT NULL,
    "joinMinutesBefore" INTEGER NOT NULL,
    "joinMinutesAfter" INTEGER NOT NULL,

    CONSTRAINT "HospitalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CatalogMedication" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "strength" TEXT NOT NULL,

    CONSTRAINT "CatalogMedication_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CatalogDiagnosis" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "CatalogDiagnosis_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CatalogImaging" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "bodyRegion" TEXT NOT NULL,

    CONSTRAINT "CatalogImaging_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CatalogLaboratory" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sample" TEXT NOT NULL,

    CONSTRAINT "CatalogLaboratory_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_patientNumber_key" ON "User"("patientNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_staffId_key" ON "User"("staffId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_consultantSlug_idx" ON "User"("consultantSlug");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_slug_key" ON "Department"("slug");

-- CreateIndex
CREATE INDEX "Department_group_idx" ON "Department"("group");

-- CreateIndex
CREATE INDEX "Department_patientBooking_idx" ON "Department"("patientBooking");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_reference_key" ON "Appointment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_slotKey_key" ON "Appointment"("slotKey");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_pendingSlotKey_key" ON "Appointment"("pendingSlotKey");

-- CreateIndex
CREATE INDEX "Appointment_patientUserId_idx" ON "Appointment"("patientUserId");

-- CreateIndex
CREATE INDEX "Appointment_consultantSlug_idx" ON "Appointment"("consultantSlug");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_startsAt_idx" ON "Appointment"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_appointmentId_idx" ON "Payment"("appointmentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "ClinicalRecord_appointmentId_idx" ON "ClinicalRecord"("appointmentId");

-- CreateIndex
CREATE INDEX "ClinicalRecord_patientUserId_idx" ON "ClinicalRecord"("patientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_idempotencyKey_key" ON "Encounter"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Encounter_patientUserId_idx" ON "Encounter"("patientUserId");

-- CreateIndex
CREATE INDEX "Encounter_appointmentId_idx" ON "Encounter"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_appointmentId_version_key" ON "Encounter"("appointmentId", "version");

-- CreateIndex
CREATE INDEX "Document_ownerUserId_idx" ON "Document"("ownerUserId");

-- CreateIndex
CREATE INDEX "Document_appointmentId_idx" ON "Document"("appointmentId");

-- CreateIndex
CREATE INDEX "Allergy_patientUserId_idx" ON "Allergy"("patientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Journey_reference_key" ON "Journey"("reference");

-- CreateIndex
CREATE INDEX "Journey_appointmentId_idx" ON "Journey"("appointmentId");

-- CreateIndex
CREATE INDEX "Journey_patientUserId_idx" ON "Journey"("patientUserId");

-- CreateIndex
CREATE INDEX "Journey_queueStatus_idx" ON "Journey"("queueStatus");

-- CreateIndex
CREATE INDEX "JourneyEvent_journeyId_idx" ON "JourneyEvent"("journeyId");

-- CreateIndex
CREATE INDEX "JourneyEvent_appointmentId_idx" ON "JourneyEvent"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispense_reference_key" ON "Dispense"("reference");

-- CreateIndex
CREATE INDEX "Dispense_appointmentId_idx" ON "Dispense"("appointmentId");

-- CreateIndex
CREATE INDEX "Dispense_patientUserId_idx" ON "Dispense"("patientUserId");

-- CreateIndex
CREATE INDEX "Dispense_status_idx" ON "Dispense"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_name_idx" ON "InventoryItem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InvestigationOrder_reference_key" ON "InvestigationOrder"("reference");

-- CreateIndex
CREATE INDEX "InvestigationOrder_appointmentId_idx" ON "InvestigationOrder"("appointmentId");

-- CreateIndex
CREATE INDEX "InvestigationOrder_patientUserId_idx" ON "InvestigationOrder"("patientUserId");

-- CreateIndex
CREATE INDEX "InvestigationOrder_kind_status_idx" ON "InvestigationOrder"("kind", "status");

-- CreateIndex
CREATE INDEX "ObservationOrder_patientUserId_active_idx" ON "ObservationOrder"("patientUserId", "active");

-- CreateIndex
CREATE INDEX "Observation_patientUserId_idx" ON "Observation"("patientUserId");

-- CreateIndex
CREATE INDEX "Observation_orderId_idx" ON "Observation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeskPayment_reference_key" ON "DeskPayment"("reference");

-- CreateIndex
CREATE INDEX "DeskPayment_patientUserId_idx" ON "DeskPayment"("patientUserId");

-- CreateIndex
CREATE INDEX "DeskPayment_appointmentId_idx" ON "DeskPayment"("appointmentId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_patientUserId_idx" ON "MedicationAdministration"("patientUserId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_encounterId_medicationItemId_sched_idx" ON "MedicationAdministration"("encounterId", "medicationItemId", "scheduledFor");

-- CreateIndex
CREATE INDEX "NursingTask_patientUserId_idx" ON "NursingTask"("patientUserId");

-- CreateIndex
CREATE INDEX "NursingTask_assignedNurseUserId_idx" ON "NursingTask"("assignedNurseUserId");

-- CreateIndex
CREATE INDEX "NursingTask_sourceKey_idx" ON "NursingTask"("sourceKey");

-- CreateIndex
CREATE INDEX "Shift_nurseUserId_idx" ON "Shift"("nurseUserId");

-- CreateIndex
CREATE INDEX "Handover_shiftId_idx" ON "Handover"("shiftId");

-- CreateIndex
CREATE INDEX "Handover_authorUserId_idx" ON "Handover"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Bed_wardId_label_key" ON "Bed"("wardId", "label");

-- CreateIndex
CREATE INDEX "Admission_patientUserId_idx" ON "Admission"("patientUserId");

-- CreateIndex
CREATE INDEX "Admission_bedId_idx" ON "Admission"("bedId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_appointmentId_key" ON "Rating"("appointmentId");

-- CreateIndex
CREATE INDEX "Rating_consultantSlug_idx" ON "Rating"("consultantSlug");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_route_key" ON "IdempotencyKey"("userId", "key", "route");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
