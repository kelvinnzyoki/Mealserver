import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

// Used for local development and for any non-serverless host (Render,
// Railway, Fly.io, a plain VM). On Vercel, api/index.ts exports `app`
// directly instead and Vercel's Node runtime handles the listening part —
// server.ts is simply never imported in that deployment path.
app.listen(env.port, () => {
  logger.info(`KulaGo API listening on port ${env.port}`, { env: env.nodeEnv });
});
