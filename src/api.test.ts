import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createObjectStorage, type PaystackClient } from "./providers";

const amounts = new Map<string, number>();
const paystack: PaystackClient = {
  async initialize(input) {
    amounts.set(input.reference, input.amountKobo);
    return { authorizationUrl: `https://paystack.test/pay/${input.reference}`, reference: input.reference, accessCode: "test" };
  },
  async verify(reference) {
    const amountKobo = amounts.get(reference);
    if (!amountKobo) throw new Error("unknown reference");
    return { status: "success", amountKobo, reference };
  },
};

const env = loadEnv();
const prisma = new PrismaClient();
const app = createApp(env, { async send() { return { delivered: false }; } }, createObjectStorage(), paystack, { async enqueue() {} });

const patient = {
  firstName: "Ada",
  lastName: "Patient",
  email: `ada.${Date.now()}@patients.oouth.local`,
  phone: "08030000000",
  dateOfBirth: "1990-01-01",
  gender: "female" as const,
  address: "Sagamu",
  password: "Patient#2026",
};

const note = {
  chiefComplaint: "Severe headache",
  assessment: "Tension headache",
  plan: "Rest and analgesia",
  prescriptionStatus: "prescribed",
  medications: [{
    id: "PARA-500",
    name: "Paracetamol",
    dose: "500mg",
    route: "Oral",
    frequency: "Three times daily",
    duration: "3 days",
    quantity: "9",
    timing: "After food",
  }],
  sharedWithPatient: true,
};

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DO $$ DECLARE r RECORD; BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') LOOP
      EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
    END LOOP;
  END $$;`);
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: process.env });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("hospital API", () => {
  it("registers a patient and rejects an unknown login with the same message as a wrong password", async () => {
    const agent = request.agent(app);
    const created = await agent.post("/api/auth/register").send(patient);
    expect(created.status).toBe(201);
    expect(created.body.data.patientNumber).toMatch(/^OOUTH-P-/);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(patient.email);
    const unknown = await request(app).post("/api/auth/login").send({ email: "missing@patients.oouth.local", password: "Patient#2026" });
    const wrong = await request(app).post("/api/auth/login").send({ email: patient.email, password: "wrong-password" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    const reset = await request(app).post("/api/auth/password-reset").send({ email: patient.email });
    expect(reset.status).toBe(202);
  });

  it("keeps one slot for one visit and confirms a Paystack reference only once", async () => {
    const slots = await request(app).get("/api/departments/medicine/slots").query({ date: "2026-11-16", type: "virtual" });
    expect(slots.status).toBe(200);
    const slot = slots.body.data[0];
    expect(slot?.startsAt).toBeTruthy();
    const first = request.agent(app);
    await first.post("/api/auth/login").send({ email: patient.email, password: patient.password }).expect(200);
    const booked = await first.post("/api/appointments").send({
      departmentSlug: "medicine",
      consultationType: "virtual",
      startsAt: slot.startsAt,
      reason: "Headache for two days",
      privacyConsent: true,
      telemedicineConsent: true,
    });
    expect(booked.status).toBe(201);
    const other = request.agent(app);
    const secondPatient = { ...patient, email: `bola.${Date.now()}@patients.oouth.local`, firstName: "Bola" };
    await other.post("/api/auth/register").send(secondPatient).expect(201);
    const clash = await other.post("/api/appointments").send({
      departmentSlug: "medicine",
      consultationType: "virtual",
      startsAt: slot.startsAt,
      reason: "Same hour request",
      privacyConsent: true,
      telemedicineConsent: true,
    });
    expect(clash.status).toBe(409);

    const started = await first.post("/api/payments/initialize").send({ appointmentId: booked.body.data.id });
    expect(started.status).toBe(200);
    expect(started.body.data.authorizationUrl).toContain("paystack.test");
    const reference = started.body.data.reference as string;
    const verified = await first.post("/api/payments/verify").send({ reference });
    expect(verified.status).toBe(200);
    expect(verified.body.data.duplicate).toBe(false);
    expect(verified.body.data.appointment.status).toBe("confirmed");
    const again = await first.post("/api/payments/verify").send({ reference });
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(await prisma.payment.count({ where: { reference, status: "verified" } })).toBe(1);
  });

  it("rejects a stale draft, requires a real consultation before signing, and blocks a repeat signature", async () => {
    const appointment = await prisma.appointment.findFirst({ where: { status: "confirmed" } });
    expect(appointment).toBeTruthy();
    const consultant = request.agent(app);
    await consultant.post("/api/auth/login").send({ email: "super_consultant@preview.local", password: "Preview#2026" }).expect(200);
    const stale = await consultant.patch(`/api/appointments/${appointment!.id}/encounter`).send({
      expectedRevision: 4,
      idempotencyKey: "draft-stale-01",
      chiefComplaint: "Changed complaint",
    });
    expect(stale.status).toBe(409);
    const saved = await consultant.patch(`/api/appointments/${appointment!.id}/encounter`).send({
      expectedRevision: 0,
      idempotencyKey: "draft-first-01",
      chiefComplaint: "Severe headache",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.revision).toBe(1);
    const empty = await consultant.post(`/api/appointments/${appointment!.id}/encounter/sign`).send({
      baseVersion: 0,
      idempotencyKey: "sign-empty-01",
      prescriptionStatus: "none",
    });
    expect(empty.status).toBe(400);
    const signed = await consultant.post(`/api/appointments/${appointment!.id}/encounter/sign`).send({
      baseVersion: 0,
      idempotencyKey: "sign-first-01",
      ...note,
    });
    expect(signed.status).toBe(200);
    expect(signed.body.data.version).toBe(1);
    const replay = await consultant.post(`/api/appointments/${appointment!.id}/encounter/sign`).send({
      baseVersion: 1,
      idempotencyKey: "sign-first-01",
      ...note,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.data.duplicate).toBe(true);
    const amendment = await consultant.post(`/api/appointments/${appointment!.id}/encounter/sign`).send({
      baseVersion: 1,
      idempotencyKey: "sign-same-02",
      ...note,
    });
    expect(amendment.status).toBe(409);
  });

  it("checks a paid visit in once and refuses to dispense more than the stock on hand", async () => {
    const appointment = await prisma.appointment.findFirst({ where: { status: "completed" } });
    const desk = request.agent(app);
    await desk.post("/api/auth/login").send({ email: "desk@preview.local", password: "Preview#2026" }).expect(200);
    const checked = await desk.post(`/api/desk/appointments/${appointment!.id}/check-in`).send({ mode: "check_in" });
    expect(checked.status).toBe(200);
    const repeat = await desk.post(`/api/desk/appointments/${appointment!.id}/check-in`).send({ mode: "check_in" });
    expect(repeat.status).toBe(409);

    const line = await prisma.dispense.findFirst({ where: { appointmentId: appointment!.id } });
    expect(line?.medicationName).toBe("Paracetamol");
    const pharmacy = request.agent(app);
    await pharmacy.post("/api/auth/login").send({ email: "pharmacy@preview.local", password: "Preview#2026" }).expect(200);
    await pharmacy.post(`/api/pharmacy/dispenses/${line!.id}`).send({ action: "verify" }).expect(200);
    const tooMuch = await pharmacy.post(`/api/pharmacy/dispenses/${line!.id}`).send({ action: "full", quantity: 500, instructions: "As prescribed" });
    expect(tooMuch.status).toBe(400);
    const dispensed = await pharmacy.post(`/api/pharmacy/dispenses/${line!.id}`).send({ action: "full", quantity: 2, instructions: "As prescribed" });
    expect(dispensed.status).toBe(200);
    const stock = await prisma.inventoryItem.findFirst({ where: { name: "Paracetamol" } });
    expect(stock?.quantity).toBe(98);
  });

  it("blocks a nurse from pharmacy stock and a pharmacist from nursing records", async () => {
    const nurse = request.agent(app);
    await nurse.post("/api/auth/login").send({ email: "nurse@preview.local", password: "Preview#2026" }).expect(200);
    const pharmacyList = await nurse.get("/api/pharmacy/dispenses");
    expect(pharmacyList.status).toBe(403);
    const pharmacist = request.agent(app);
    await pharmacist.post("/api/auth/login").send({ email: "pharmacy@preview.local", password: "Preview#2026" }).expect(200);
    const nursingList = await pharmacist.get("/api/nursing/administrations");
    expect(nursingList.status).toBe(403);
  });
});
