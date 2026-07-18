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
});
