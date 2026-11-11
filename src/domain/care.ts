export type DispenseAction =
  | { kind: "verify" }
  | { kind: "review" }
  | { kind: "clarify"; clarification: string }
  | { kind: "full" | "partial" | "unavailable"; quantity: number; instructions: string; substitution: string }
  | { kind: "cancel" };

export function applyDispense(record: { verifiedPatient: boolean; status: string; quantityDispensed: number; substitution: string; medicationName: string }, stockQuantity: number | null, action: DispenseAction) {
  if (action.kind === "verify") return { ok: true as const, patch: { verifiedPatient: true } };
  if (action.kind === "review") return { ok: true as const, patch: { status: "under_review" } };
  if (action.kind === "clarify") {
    if (!action.clarification.trim()) return { ok: false as const, error: "Enter the clarification request." };
    return { ok: true as const, patch: { status: "awaiting_clarification", clarification: action.clarification.trim() } };
  }
  if (action.kind === "cancel") return { ok: true as const, patch: { status: "cancelled" } };
  if (!record.verifiedPatient) return { ok: false as const, error: "Verify the patient before dispensing." };
  if (action.kind === "unavailable") {
    return { ok: true as const, patch: { status: "partially_dispensed", dispensingInstructions: action.instructions.trim(), substitution: action.substitution.trim() }, stockDelta: 0 };
  }
  const quantity = Math.floor(action.quantity);
  if (quantity < 1) return { ok: false as const, error: "Enter a quantity of at least 1." };
  if (stockQuantity !== null && stockQuantity < quantity) return { ok: false as const, error: "The quantity in stock is lower than the amount to dispense." };
  return {
    ok: true as const,
    patch: {
      status: action.kind === "full" ? "dispensed" : "partially_dispensed",
      quantityDispensed: record.quantityDispensed + quantity,
      dispensingInstructions: action.instructions.trim(),
      substitution: action.substitution.trim() || record.substitution,
    },
    stockDelta: stockQuantity === null ? 0 : quantity,
  };
}

export function scoreRating(scores: number[]) {
  if (scores.some((score) => !Number.isInteger(score) || score < 1 || score > 5)) return "Each rating must be from 1 to 5.";
  return null;
}

const deskStatuses = ["registered", "awaiting_payment", "checked_in", "early_arrival", "waiting_for_nurse", "waiting_for_consultant", "ready_for_consultation", "ready_for_discharge", "completed", "cancelled"];

export function canSetQueue(role: "desk_officer" | "consultant" | "nurse", status: string) {
  if (role === "desk_officer") return deskStatuses.includes(status);
  if (role === "consultant") return ["consultation_in_progress", "awaiting_investigation", "awaiting_pharmacy", "ready_for_discharge", "completed"].includes(status);
  return status === "waiting_for_consultant";
}
