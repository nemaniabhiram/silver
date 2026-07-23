import { z } from "zod";

const flag = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://silver:silver@localhost:5433/silver"),

  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_ACCESS_KEY: z.string().min(1).default("silver"),
  S3_SECRET_KEY: z.string().min(1).default("silver-secret"),
  S3_BUCKET: z.string().min(1).default("silver"),
  S3_FORCE_PATH_STYLE: flag.default("true"),

  DEPLOY_DOMAIN: z.string().min(1).default("localhost:4001"),
  DEPLOY_PROTOCOL: z.enum(["http", "https"]).default("http"),

  API_PORT: positiveInt.default(4000),
  SERVE_PORT: positiveInt.default(4001),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  TRUST_PROXY: flag.default("false"),

  MAX_UPLOAD_MB: positiveInt.default(50),
  RATE_LIMIT_DEPLOYS_PER_HOUR: positiveInt.default(10),
  RATE_LIMIT_READS_PER_MINUTE: positiveInt.default(120),

  POLL_INTERVAL_MS: positiveInt.default(1500),
  MAX_CONCURRENT_BUILDS: positiveInt.default(1),
  BUILD_TIMEOUT_SECONDS: positiveInt.default(300),
  BUILD_MEMORY_MB: positiveInt.default(1024),
  BUILD_CPUS: positiveInt.default(1),
  MAX_OUTPUT_MB: positiveInt.default(100),
  BUILDER_IMAGE: z.string().min(1).default("silver-builder:latest"),

  RETENTION_DAYS: nonNegativeInt.default(7),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
