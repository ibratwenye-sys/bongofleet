import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required().min(1),
  REDIS_URL: Joi.string().required().min(1),

  JWT_ACCESS_SECRET: Joi.string().required().min(1),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().required().min(1),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  CORS_ORIGINS: Joi.string().allow('').default(''),

  // Parsed and validated for real in trust-proxy.util.ts (hop count vs
  // address/subnet vs the disallowed "true") - this only checks it's a
  // string, same division of labor as CORS_ORIGINS above.
  TRUST_PROXY: Joi.string().allow('').default(''),

  UPLOADS_DIR: Joi.string().default('./uploads'),

  // --- Outgoing email (document expiry alerts etc.) ---
  // SMTP_HOST left blank = "log-only" mode: emails are written to the app log
  // instead of being sent. Safe default for development; set a real SMTP host
  // (e.g. an SES/Mailgun/Zoho relay) in production.
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('BongoFleet <no-reply@bongofleet.app>'),

  // --- Document expiry scan ---
  DOCUMENT_EXPIRY_ALERT_DAYS: Joi.number().integer().min(1).max(365).default(30),
  DOCUMENT_EXPIRY_CRON: Joi.string().default('0 7 * * *'),
  DOCUMENT_EXPIRY_TZ: Joi.string().default('Africa/Dar_es_Salaam'),

  // --- Missed-payment scan ---
  MISSED_PAYMENT_CRON: Joi.string().default('30 7 * * *'),
  MISSED_PAYMENT_LOOKBACK_DAYS: Joi.number().integer().min(1).max(90).default(7),

  // --- Maintenance reminder scan ---
  MAINTENANCE_REMINDER_CRON: Joi.string().default('0 8 * * *'),
  MAINTENANCE_REMINDER_DAYS: Joi.number().integer().min(1).max(365).default(14),
  MAINTENANCE_REMINDER_MILEAGE: Joi.number().integer().min(0).max(100000).default(500),

  // --- Ownership-plan nightly instalment generator ---
  OWNERSHIP_PLAN_GENERATOR_CRON: Joi.string().default('5 0 * * *'),
  OWNERSHIP_PLAN_BACKFILL_LOOKBACK_DAYS: Joi.number().integer().min(1).max(90).default(14),

  // --- Stage S1: tenant trial and cleanup ---
  // Two settings that happen to share a number today (both 7) and must never
  // be collapsed into one: TENANT_TRIAL_DAYS governs how long a VERIFIED
  // tenant may use the product before being locked (tenant-lock.util.ts);
  // ABANDONED_SIGNUP_RETENTION_DAYS governs how long an UNVERIFIED tenant's
  // row is kept before the cleanup cron deletes it
  // (abandoned-signup-cleanup.service.ts). They answer unrelated questions -
  // "how generous is the trial" versus "how long do we keep junk around" -
  // and changing one must never silently change the other. Ibrahim set the
  // trial to 7 days here; if that number moves, this one stays put unless a
  // second, separate decision changes it too.
  TENANT_TRIAL_DAYS: Joi.number().integer().min(1).max(90).default(7),
  ABANDONED_SIGNUP_RETENTION_DAYS: Joi.number().integer().min(1).max(90).default(7),
  ABANDONED_SIGNUP_CLEANUP_CRON: Joi.string().default('30 3 * * *'),

  // --- API docs (Swagger/OpenAPI) ---
  // Same fail-safe-by-default pattern as CORS_ORIGINS: off unless explicitly
  // turned on. main.ts only mounts /api/docs when NODE_ENV !== 'production'
  // OR this is true - a production deploy never gets a public schema/docs
  // endpoint by accident, only by someone deliberately setting this.
  SWAGGER_ENABLED: Joi.boolean().default(false),
});
