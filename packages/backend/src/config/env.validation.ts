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
});
