export type EncounterBody = {
  chiefComplaint: string;
  symptomDuration: string;
  history: string;
  examination: string;
  assessment: string;
  remoteLimitation: string;
  plan: string;
  lifestyleAdvice: string;
  homeCare: string;
  warningSigns: string;
  emergencyInstructions: string;
  nextSteps: string;
  diagnoses: Array<{ id: string; code: string; name: string; system: string; category: string; type: string; certainty: string }>;
  prescriptionStatus: "none" | "prescribed";
  medications: Array<Record<string, string>>;
  investigations: Array<Record<string, string | boolean>>;
  imaging: Array<Record<string, string | boolean>>;
  followUp: { required: boolean; recommendedDate: string; consultationType: string; reason: string };
  referrals: Array<Record<string, string>>;
  admissions: Array<Record<string, string>>;
  sharedWithPatient: boolean;
};

const BODY_KEYS: Array<keyof EncounterBody> = [
  "chiefComplaint", "symptomDuration", "history", "examination", "assessment", "remoteLimitation", "plan",
  "lifestyleAdvice", "homeCare", "warningSigns", "emergencyInstructions", "nextSteps", "diagnoses",
  "prescriptionStatus", "medications", "investigations", "imaging", "followUp", "referrals", "admissions", "sharedWithPatient",
];

export function normalizeEncounterBody(input: Partial<EncounterBody> = {}): EncounterBody {
  const medications = (input.medications ?? []).map((item) => ({ ...item }));
  const consultationType = input.followUp?.consultationType;
  return {
    chiefComplaint: input.chiefComplaint ?? "",
    symptomDuration: input.symptomDuration ?? "",
    history: input.history ?? "",
    examination: input.examination ?? "",
    assessment: input.assessment ?? "",
    remoteLimitation: input.remoteLimitation ?? "",
    plan: input.plan ?? "",
    lifestyleAdvice: input.lifestyleAdvice ?? "",
    homeCare: input.homeCare ?? "",
    warningSigns: input.warningSigns ?? "",
    emergencyInstructions: input.emergencyInstructions ?? "",
    nextSteps: input.nextSteps ?? "",
    diagnoses: (input.diagnoses ?? []).map((item) => ({ ...item })),
    prescriptionStatus: input.prescriptionStatus ?? (medications.length > 0 ? "prescribed" : "none"),
    medications,
    investigations: (input.investigations ?? []).map((item) => ({ ...item })),
    imaging: (input.imaging ?? []).map((item) => ({ ...item })),
    followUp: {
      required: input.followUp?.required ?? false,
      recommendedDate: input.followUp?.recommendedDate ?? "",
      consultationType: consultationType === "virtual" || consultationType === "physical" ? consultationType : "",
      reason: input.followUp?.reason ?? "",
    },
    referrals: (input.referrals ?? []).map((item) => ({ ...item })),
    admissions: (input.admissions ?? []).map((item) => ({ ...item })),
    sharedWithPatient: input.sharedWithPatient ?? false,
  };
}

function choiceFilled(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 && text !== "Other";
}

export function validateEncounter(input: EncounterBody) {
  const body = normalizeEncounterBody(input);
  const hasContent = Boolean(
    body.chiefComplaint.trim() || body.history.trim() || body.assessment.trim() || body.plan.trim() ||
    body.diagnoses.length || body.medications.length || body.investigations.length || body.imaging.length ||
    body.referrals.length || body.admissions.length || body.followUp.required,
  );
  if (!hasContent) return "Add a complaint, assessment, diagnosis, medicine, test, scan, referral, admission, or follow-up before signing.";
  if (body.diagnoses.some((item) => item.name.trim().length < 2)) return "Each diagnosis needs a name.";
  if (body.prescriptionStatus === "prescribed" && body.medications.length === 0) return "Add at least one medicine, or choose no prescription.";
  if (body.prescriptionStatus === "none" && body.medications.length > 0) return "Choose prescribed, or remove the medicines.";
  if (body.medications.some((item) => !String(item.name ?? "").trim() || !String(item.dose ?? "").trim() || !choiceFilled(item.route) || !choiceFilled(item.frequency) || !choiceFilled(item.duration) || !String(item.quantity ?? "").trim() || !choiceFilled(item.timing))) {
    return "Each medicine needs a dose, route, frequency, duration, quantity, and timing.";
  }
  if (body.investigations.some((item) => String(item.name ?? "").trim().length < 2 || String(item.reason ?? "").trim().length < 2)) return "Each laboratory test needs a name and a reason.";
  if (body.imaging.some((item) => !String(item.name ?? "").trim() || !String(item.indication ?? "").trim())) return "Each scan needs a study and the reason for the scan.";
  if (body.followUp.required) {
    if (!body.followUp.recommendedDate) return "A required follow-up needs a recommended date.";
    if (body.followUp.consultationType !== "virtual" && body.followUp.consultationType !== "physical") return "A required follow-up needs a virtual or physical visit.";
    if (body.followUp.reason.trim().length < 2) return "A required follow-up needs a reason.";
  }
  if (body.referrals.some((item) => !String(item.toDepartmentSlug ?? "").trim() || !String(item.reason ?? "").trim())) return "Each referral needs a department and a reason.";
  if (body.admissions.some((item) => !String(item.wardName ?? "").trim() || !String(item.provisionalDiagnosis ?? "").trim() || !String(item.reason ?? "").trim())) {
    return "Each admission request needs a ward, a provisional diagnosis, and a reason.";
  }
  return null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function changedEncounterFields(previous: EncounterBody, next: EncounterBody) {
  return BODY_KEYS.filter((key) => stable(previous[key]) !== stable(next[key]));
}

export function consultationReportReference(appointmentReference: string) {
  const suffix = appointmentReference.replace(/^OOUTH-(APT|TC|RX)-/i, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `OOUTH-TC-${suffix || "RECORD"}`;
}

export function prescriptionReference(appointmentReference: string) {
  return consultationReportReference(appointmentReference).replace(/^OOUTH-TC-/, "OOUTH-RX-");
}

export const REMOTE_ASSESSMENT_NOTICE = "A video consultation cannot replace a physical examination. Findings are limited to what could be seen and discussed remotely.";

export function buildConsultationReport(input: {
  body: EncounterBody;
  patientName: string;
  patientNumber: string;
  consultantName: string;
  departmentName: string;
  consultationType: string;
  startsAt: string;
  durationMinutes: number;
  appointmentReference: string;
  signedAt: string | null;
  version: number;
  reportReference: string;
}) {
  const body = normalizeEncounterBody(input.body);
  const prescribed = body.prescriptionStatus === "prescribed" && body.medications.length > 0;
  return {
    status: "Completed",
    patientName: input.patientName,
    patientNumber: input.patientNumber || "Not issued",
    consultantName: input.consultantName,
    departmentName: input.departmentName,
    consultationType: input.consultationType === "virtual" ? "Virtual" : "Physical",
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes,
    appointmentReference: input.appointmentReference,
    reportReference: input.reportReference,
    prescriptionReference: prescribed ? prescriptionReference(input.appointmentReference) : null,
    signedAt: input.signedAt,
    version: input.version,
    amended: input.version > 1,
    remoteAssessmentNotice: REMOTE_ASSESSMENT_NOTICE,
    presentingComplaint: body.chiefComplaint,
    assessment: body.assessment,
    diagnoses: body.diagnoses,
    medications: prescribed ? body.medications : [],
    prescriptionStatus: body.prescriptionStatus,
    investigations: body.investigations,
    imaging: body.imaging,
    treatmentPlan: body.plan,
    emergencyInstructions: body.emergencyInstructions,
    followUp: body.followUp,
    body,
  };
}

export function buildHandoff(body: EncounterBody, input: { audience: string; patientName: string; patientNumber: string; reference: string; consultantName: string; version: number; signed: boolean }) {
  const base = {
    audience: input.audience,
    title: input.audience === "pharmacy" ? "Pharmacy order" : input.audience === "imaging" ? "Imaging request" : input.audience === "referral" ? "Referral" : "Admission request",
    patientName: input.patientName,
    patientNumber: input.patientNumber,
    reference: input.reference,
    consultantName: input.consultantName,
    signedLabel: input.signed ? `Signed version ${input.version}` : "Draft — not signed",
  };
  if (input.audience === "pharmacy") return { ...base, medications: body.medications };
  if (input.audience === "imaging") return { ...base, imaging: body.imaging };
  if (input.audience === "referral") return { ...base, referrals: body.referrals };
  if (input.audience === "admission") return { ...base, admissions: body.admissions };
  return null;
}
