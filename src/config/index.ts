// 🔧 FLOWMATIK BACKEND - CONFIGURATION MANAGER

import dotenv from 'dotenv';
import { AppConfig } from '@/types';

// Load environment variables
dotenv.config();

/**
 * 🎯 Validates that all required environment variables are present
 */
const validateEnvironment = (): void => {
  const required = [
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'JWT_SECRET',
    'SILICONFLOW_API_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

/**
 * 🏗️ Application configuration object
 */
export const config: AppConfig = {
  app: {
    name: process.env.APP_NAME || 'Flowmatik Backend',
    version: process.env.API_VERSION || 'v1',
    environment: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    url: process.env.APP_URL || 'http://localhost:3000',
  },

  database: {
    url: process.env.DATABASE_URL!,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
    timeout: parseInt(process.env.DB_TIMEOUT || '30000', 10),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  siliconflow: {
    apiKey: process.env.SILICONFLOW_API_KEY!,
    baseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
    models: {
      text: process.env.SILICONFLOW_MODEL_TEXT || 'doubao-1.5-pro-32k',
      image: process.env.SILICONFLOW_MODEL_IMAGE || 'black-forest-labs/FLUX.1-schnell',
      video: process.env.SILICONFLOW_MODEL_VIDEO || 'Wan-AI/Wan2.1-T2V-14B-Turbo',
      audio: process.env.SILICONFLOW_MODEL_AUDIO || 'FunAudioLLM/CosyVoice2-0.5B',
    },
  },

  payment: {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    },
    lemonSqueezy: {
      apiKey: process.env.LEMONSQUEEZY_API_KEY || '',
      storeId: process.env.LEMONSQUEEZY_STORE_ID || '',
      webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '',
    },
  },
};

/**
 * 🎯 Additional configuration objects
 */
export const corsConfig = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: process.env.CORS_CREDENTIALS === 'true',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

export const rateLimitConfig = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
};

export const uploadConfig = {
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'application/pdf',
    'text/plain',
  ],
};

export const cacheConfig = {
  ttl: parseInt(process.env.CACHE_TTL || '3600', 10), // 1 hour
  maxKeys: parseInt(process.env.CACHE_MAX_KEYS || '10000', 10),
  checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD || '600', 10), // 10 minutes
};

export const logConfig = {
  level: process.env.LOG_LEVEL || 'info',
  filePath: process.env.LOG_FILE_PATH || './logs',
  maxFiles: parseInt(process.env.LOG_MAX_FILES || '14', 10), // 14 days
  maxSize: process.env.LOG_MAX_SIZE || '20m',
};

export const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  from: process.env.EMAIL_FROM || 'noreply@flowmatik.co',
};

export const larkConfig = {
  appId: process.env.LARK_APP_ID || '',
  appSecret: process.env.LARK_APP_SECRET || '',
  webhookUrl: process.env.LARK_WEBHOOK_URL || '',
};

export const swaggerConfig = {
  enabled: process.env.SWAGGER_ENABLED === 'true',
  title: 'Flowmatik API',
  description: 'Backend definitivo para Flowmatik con arquitectura MCP',
  version: '1.0.0',
  basePath: `/api/${config.app.version}`,
};

/**
 * 🚀 Initialize configuration
 */
export const initializeConfig = (): void => {
  try {
    validateEnvironment();
    console.log(`🚀 Configuration loaded for ${config.app.environment} environment`);
  } catch (error) {
    console.error('❌ Configuration validation failed:', error);
    process.exit(1);
  }
};

/**
 * 🎯 Helper functions
 */
export const isDevelopment = (): boolean => config.app.environment === 'development';
export const isProduction = (): boolean => config.app.environment === 'production';
export const isTest = (): boolean => config.app.environment === 'test';

/**
 * 🔧 Feature flags
 */
export const features = {
  swagger: isDevelopment() || swaggerConfig.enabled,
  debug: isDevelopment() || process.env.DEBUG === 'true',
  metrics: isProduction() || process.env.METRICS_ENABLED === 'true',
  rateLimit: isProduction() || process.env.RATE_LIMIT_ENABLED === 'true',
  cors: true,
  compression: true,
  helmet: isProduction(),
};

export default config;

