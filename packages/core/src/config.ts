import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  TELEGRAM_BOT_TOKEN: z.string().optional().transform((v) => v || undefined),
  X_PUBLISH_MODE: z.enum(['simulated', 'live']).default('simulated'),
  CONTENT_GENERATOR: z.enum(['simulated', 'claude']).default('simulated'),
  DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(2),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
