export const HOSPITAL_TIME_ZONE = "Africa/Lagos";

export type FeeSettings = {
  consultationPerHourNaira: number;
  registrationFeeNaira: number;
  defaultDurationMinutes: number;
};

export type PolicySettings = {
  cancellationNoticeHours: number;
  rescheduleNoticeHours: number;
  joinMinutesBefore: number;
  joinMinutesAfter: number;
};

export type Availability = {
  consultantSlug: string;
  days: number[];
  startTime: string;
  endTime: string;
  durationMinutes: number;
  breaks: Array<{ start: string; end: string }>;
  blockedDates: string[];
  physicalEnabled: boolean;
  virtualEnabled: boolean;
  provisional: boolean;
};

export type Slot = { date: string; time: string; startsAt: string; endsAt: string };

const ACTIVE = new Set(["pending_payment", "confirmed", "scheduled", "awaiting_triage", "in_progress", "completed", "no_show"]);

export function lagosCalendarYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: HOSPITAL_TIME_ZONE, year: "numeric" }).format(now));
}

export function lagosToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOSPITAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function lagosDayKey(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOSPITAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function registrationIsDue(paidYear: number | null | undefined, now = new Date()) {
  return paidYear !== lagosCalendarYear(now);
}

export function rescheduleCharge(consultationFeeNaira: number) {
  return Math.round(consultationFeeNaira * 0.1);
}

export function calculateFees(fees: FeeSettings, durationMinutes: number, registrationDue: boolean) {
  const consultationNaira = Math.round(fees.consultationPerHourNaira * (durationMinutes / 60));
  const registrationNaira = registrationDue ? fees.registrationFeeNaira : 0;
  return { consultationNaira, registrationNaira, totalNaira: consultationNaira + registrationNaira, durationMinutes };
}

export function weekdayIndex(date: string) {
  return new Date(`${date}T12:00:00+01:00`).getUTCDay();
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function fromMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function slotsForDate(date: string, availability: Availability, taken: Set<string>, now = new Date()): Slot[] {
  if (!availability.days.includes(weekdayIndex(date))) return [];
  if (availability.blockedDates.includes(date)) return [];
  const start = toMinutes(availability.startTime);
  const end = toMinutes(availability.endTime);
  const duration = availability.durationMinutes;
  const breaks = availability.breaks.map((item) => ({ start: toMinutes(item.start), end: toMinutes(item.end) }));
  const slots: Slot[] = [];
  for (let cursor = start; cursor + duration <= end; cursor += duration) {
    const slotEnd = cursor + duration;
    if (breaks.some((item) => cursor < item.end && slotEnd > item.start)) continue;
    const time = fromMinutes(cursor);
    const starts = new Date(`${date}T${time}:00+01:00`);
    if (starts.getTime() <= now.getTime()) continue;
    const startsAt = starts.toISOString();
    if (taken.has(startsAt)) continue;
    slots.push({ date, time, startsAt, endsAt: new Date(starts.getTime() + duration * 60_000).toISOString() });
  }
  return slots;
}

export function defaultAvailability(slug: string): Availability {
  return {
    consultantSlug: slug,
    days: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "16:00",
    durationMinutes: 60,
    breaks: [],
    blockedDates: [],
    physicalEnabled: true,
    virtualEnabled: true,
    provisional: true,
  };
}

export function hoursUntil(iso: string, now = new Date()) {
  return (new Date(iso).getTime() - now.getTime()) / 3_600_000;
}

export function isActiveStatus(status: string) {
  return ACTIVE.has(status);
}

export function planReschedule(input: {
  role: "patient" | "consultant";
  paymentStatus: string;
  slotOpen: boolean;
  noticeOpen: boolean;
  noticeHours: number;
  consultationFeeNaira: number;
  startsAt: string;
  endsAt: string;
}) {
  if (!input.noticeOpen) return { ok: false as const, error: `Rescheduling closes ${input.noticeHours} hours before the visit.` };
  if (!input.slotOpen) return { ok: false as const, error: "That time is not available." };
  if (input.role === "consultant" || input.paymentStatus !== "verified") {
    return { ok: true as const, mode: "apply" as const, feeNaira: 0, startsAt: input.startsAt, endsAt: input.endsAt };
  }
  return { ok: true as const, mode: "pending_fee" as const, feeNaira: rescheduleCharge(input.consultationFeeNaira), startsAt: input.startsAt, endsAt: input.endsAt };
}

export function queueAfterArrival(input: { early: boolean; paid: boolean; consultantBusy: boolean }) {
  if (!input.paid) return "awaiting_payment";
  if (input.early) return "early_arrival";
  if (input.consultantBusy) return "waiting_for_consultant";
  return "ready_for_consultation";
}
