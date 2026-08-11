import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"), PORT: z.coerce.number().int().min(1).max(65535).default(3000), PUBLIC_BASE_URL: z.url(), DATABASE_PATH: z.string().min(1),
  SERVER_ACCESS_PASSWORD: z.string().min(1), MASTER_ADMIN_PASSWORD: z.string().min(1), SESSION_SECRET: z.string().min(32),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30), SQLITE_BACKUP_COUNT: z.coerce.number().int().min(1).max(365).default(7),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && value.DATABASE_PATH !== "/var/data/vat-tournaments.sqlite") context.addIssue({ code: "custom", path: ["DATABASE_PATH"], message: "Production SQLite must use /var/data/vat-tournaments.sqlite." });
});
export type ServerConfig = z.infer<typeof environmentSchema>;
export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig { return environmentSchema.parse(environment); }
