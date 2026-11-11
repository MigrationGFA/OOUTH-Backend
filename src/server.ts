import { loadDotEnv, loadEnv } from "./config/env";
import { createApp } from "./app";
import { createInlineQueue, createMailer, createObjectStorage, createPaystack, createRedisQueue } from "./providers";

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const mailer = createMailer(env);
  const storage = createObjectStorage();
  const paystack = createPaystack(env);
  const queue = env.REDIS_URL
    ? await createRedisQueue(env.REDIS_URL, async (name, payload) => {
        if (name === "email") await mailer.send({ to: payload.to, subject: payload.subject, text: payload.text });
      })
    : createInlineQueue(async (name, payload) => {
        if (name === "email") await mailer.send({ to: payload.to, subject: payload.subject, text: payload.text });
      });
  const app = createApp(env, mailer, storage, paystack, queue);
  app.listen(env.PORT, () => {
    console.log(`OOUTH API listening on ${env.PORT}`);
  });
}

void main();
