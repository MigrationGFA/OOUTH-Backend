import nodemailer from "nodemailer";
import type { Env } from "../config/env";

export type MailMessage = { to: string; subject: string; text: string };
export type Mailer = { send: (message: MailMessage) => Promise<{ delivered: boolean }> };

export function createMailer(env: Env): Mailer {
  if (!env.SMTP_HOST) {
    return { async send() { return { delivered: false }; } };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return {
    async send(message) {
      await transport.sendMail({ from: env.SMTP_FROM, to: message.to, subject: message.subject, text: message.text });
      return { delivered: true };
    },
  };
}

export type SmsSender = { send: (to: string, body: string) => Promise<{ delivered: boolean }> };

export function createSmsSender(): SmsSender {
  return { async send() { return { delivered: false }; } };
}

export type StoredObject = { bytes: Buffer; mimeType: string; name: string };
export type ObjectStorage = {
  put: (object: StoredObject) => Promise<{ bytes: Buffer }>;
};

export function createObjectStorage(): ObjectStorage {
  return { async put(object) { return { bytes: object.bytes }; } };
}

export class AzureBlobStorage implements ObjectStorage {
  async put(): Promise<{ bytes: Buffer }> {
    throw new Error("Azure Blob storage is not configured yet.");
  }
}

export type PaystackInit = { authorizationUrl: string; reference: string; accessCode: string };
export type PaystackVerify = { status: string; amountKobo: number; reference: string };
export type PaystackClient = {
  initialize: (input: { email: string; amountKobo: number; reference: string; metadata: Record<string, string>; callbackUrl?: string }) => Promise<PaystackInit>;
  verify: (reference: string) => Promise<PaystackVerify>;
};

export function createPaystack(env: Env): PaystackClient {
  const secret = env.PAYSTACK_SECRET_KEY;
  return {
    async initialize(input) {
      if (!secret) throw new Error("Paystack is not configured.");
      const response = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: input.email, amount: input.amountKobo, reference: input.reference, metadata: input.metadata, callback_url: input.callbackUrl }),
      });
      const body = await response.json() as { status?: boolean; data?: { authorization_url: string; reference: string; access_code: string }; message?: string };
      if (!response.ok || !body.status || !body.data) throw new Error(body.message || "Paystack did not start the payment.");
      return { authorizationUrl: body.data.authorization_url, reference: body.data.reference, accessCode: body.data.access_code };
    },
    async verify(reference) {
      if (!secret) throw new Error("Paystack is not configured.");
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const body = await response.json() as { status?: boolean; data?: { status: string; amount: number; reference: string }; message?: string };
      if (!response.ok || !body.data) throw new Error(body.message || "Paystack did not verify the payment.");
      return { status: body.data.status, amountKobo: body.data.amount, reference: body.data.reference };
    },
  };
}

export type JobQueue = { enqueue: (name: string, payload: Record<string, string>) => Promise<void> };

export function createInlineQueue(handler: (name: string, payload: Record<string, string>) => Promise<void>): JobQueue {
  return { async enqueue(name, payload) { await handler(name, payload); } };
}

export async function createRedisQueue(redisUrl: string, handler: (name: string, payload: Record<string, string>) => Promise<void>): Promise<JobQueue> {
  const { Queue, Worker } = await import("bullmq");
  const connection = { url: redisUrl };
  const queue = new Queue("oouth", { connection });
  new Worker("oouth", async (job) => { await handler(job.name, job.data as Record<string, string>); }, { connection });
  return { async enqueue(name, payload) { await queue.add(name, payload); } };
}
