import app from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

// Used for local development and non-serverless hosts
app.listen(env.port, () => {
  logger.info(`Mpishi254 API listening on port ${env.port}`, {
    env: env.nodeEnv,
  });
});
