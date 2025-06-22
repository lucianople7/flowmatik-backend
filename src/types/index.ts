// Core MCP Types
export interface MCPContext {
  userId: string;
  sessionId: string;
  messages: ContextMessage[];
  summary: string;
  preferences: UserPreferences;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContextMessage {
  id: string;
  type: 'user_message' | 'assistant_response' | 'system_event';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface UserPreferences {
  language?: string;
  style?: 'formal' | 'casual' | 'technical' | 'creative';
  responseLength?: 'short' | 'medium' | 'long';
  includeExplanations?: boolean;
  preferredAgents?: AgentType[];
}

export interface Agent {
  id: string;
  type: AgentType;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  capabilities: string[];
  tools: Tool[];
  costMultiplier: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  cost?: number;
}

export interface WorkflowStep {
  id: string;
  type: 'text_generation' | 'content_creation' | 'analysis' | 'workflow_optimization';
  agent: AgentType;
  instructions?: string;
  maxTokens?: number;
  includeImage?: boolean;
  includeVideo?: boolean;
  includeAudio?: boolean;
  imageStyle?: string;
  videoDuration?: number;
  voiceStyle?: string;
  analysisType?: string;
  optimizationGoal?: string;
}

export interface ReasoningResult {
  selectedAgent: AgentType;
  confidence: number;
  explanation: string;
  workflow: {
    id: string;
    steps: WorkflowStep[];
  };
  estimatedCost: number;
  estimatedTime: number;
}

// AI Integration Types
export interface AIRequest {
  userId: string;
  message: string;
  metadata?: {
    socketId?: string;
    requestId?: string;
    timestamp?: Date;
    context?: any;
  };
}

export interface AIResponse {
  content: string;
  agent: AgentType;
  cost: number;
  metadata: {
    reasoning: string;
    workflow: string;
    steps: number;
    context_used: number;
  };
  suggestions: string[];
}

export interface StreamResponse {
  content: string;
  finished: boolean;
  cost: number;
  streamId?: string;
  agent?: AgentType;
}

// SiliconFlow Types
export interface SiliconFlowConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  retryAttempts?: number;
}

export interface ModelResponse {
  content: string;
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: number;
  finishReason: string;
}

export interface ContentGenerationRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  includeImage?: boolean;
  includeVideo?: boolean;
  includeAudio?: boolean;
  imageStyle?: string;
  videoDuration?: number;
  voiceStyle?: string;
}

// Agent Types
export type AgentType = 
  | 'content_creator'
  | 'workflow_optimizer' 
  | 'data_analyst'
  | 'customer_support'
  | 'general_assistant';

// Authentication Types
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'premium';
  subscription: {
    plan: 'free' | 'starter' | 'pro' | 'business';
    status: 'active' | 'cancelled' | 'expired';
    expiresAt?: Date;
  };
  usage: {
    requestsToday: number;
    tokensToday: number;
    costToday: number;
    requestsThisMonth: number;
    tokensThisMonth: number;
    costThisMonth: number;
  };
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthToken {
  userId: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

// Payment Types
export interface Subscription {
  id: string;
  userId: string;
  plan: 'free' | 'starter' | 'pro' | 'business';
  status: 'active' | 'cancelled' | 'expired' | 'past_due';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId?: string;
  lemonSqueezySubscriptionId?: string;
  metadata: Record<string, any>;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  type: 'card' | 'paypal' | 'bank_transfer';
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  stripePaymentMethodId?: string;
}

export interface Invoice {
  id: string;
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  dueDate: Date;
  paidAt?: Date;
  items: InvoiceItem[];
  metadata: Record<string, any>;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

// Usage Tracking Types
export interface UsageRecord {
  id: string;
  userId: string;
  type: 'text_generation' | 'image_generation' | 'video_generation' | 'audio_generation';
  model: string;
  tokens?: number;
  cost: number;
  metadata: Record<string, any>;
  timestamp: Date;
}

export interface UsageAnalytics {
  period: 'day' | 'week' | 'month';
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  breakdown: {
    text: { requests: number; tokens: number; cost: number };
    image: { requests: number; cost: number };
    video: { requests: number; cost: number };
    audio: { requests: number; cost: number };
  };
  topModels: Array<{ model: string; usage: number; cost: number }>;
  dailyUsage: Array<{ date: string; requests: number; cost: number }>;
}

// API Response Types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    timestamp: Date;
    requestId: string;
    version: string;
  };
}

export interface PaginatedResponse<T> extends APIResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// WebSocket Types
export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: Date;
  requestId?: string;
}

export interface ConnectionInfo {
  socketId: string;
  userId: string;
  connectedAt: Date;
  lastActivity: Date;
  userAgent?: string;
  ipAddress?: string;
}

// Configuration Types
export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  database: {
    url: string;
    maxConnections: number;
    ssl: boolean;
  };
  redis: {
    url: string;
    maxConnections: number;
  };
  siliconflow: SiliconFlowConfig;
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
    bcryptRounds: number;
  };
  payments: {
    stripe: {
      secretKey: string;
      webhookSecret: string;
    };
    lemonSqueezy: {
      apiKey: string;
      webhookSecret: string;
    };
  };
  email: {
    provider: 'sendgrid' | 'mailgun' | 'ses';
    apiKey: string;
    fromEmail: string;
  };
  storage: {
    provider: 's3' | 'cloudinary' | 'local';
    bucket?: string;
    region?: string;
    accessKey?: string;
    secretKey?: string;
  };
  monitoring: {
    sentryDsn?: string;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
  };
}

// Error Types
export class FlowmatikError extends Error {
  public code: string;
  public statusCode: number;
  public details?: any;

  constructor(message: string, code: string, statusCode: number = 500, details?: any) {
    super(message);
    this.name = 'FlowmatikError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends FlowmatikError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends FlowmatikError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends FlowmatikError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

export class RateLimitError extends FlowmatikError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT_ERROR', 429);
    this.name = 'RateLimitError';
  }
}

export class ExternalAPIError extends FlowmatikError {
  constructor(message: string, service: string, details?: any) {
    super(message, 'EXTERNAL_API_ERROR', 502, { service, ...details });
    this.name = 'ExternalAPIError';
  }
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Database Types
export interface DatabaseConnection {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  transaction<T>(callback: (trx: DatabaseConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Cache Types
export interface CacheService {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  flush(): Promise<void>;
}

// File Upload Types
export interface FileUpload {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface UploadedFile {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  url: string;
  metadata: Record<string, any>;
  uploadedAt: Date;
}

// Webhook Types
export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  source: 'stripe' | 'lemon_squeezy' | 'internal';
  processed: boolean;
  attempts: number;
  lastAttempt?: Date;
  error?: string;
}

// Monitoring Types
export interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  services: {
    database: { status: string; latency?: number };
    redis: { status: string; latency?: number };
    siliconflow: { status: string; latency?: number };
    storage: { status: string; latency?: number };
  };
  metrics: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
  };
}

export interface Metrics {
  requests: {
    total: number;
    success: number;
    error: number;
    averageResponseTime: number;
  };
  ai: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    averageResponseTime: number;
  };
  users: {
    total: number;
    active: number;
    premium: number;
  };
  revenue: {
    monthly: number;
    daily: number;
    averagePerUser: number;
  };
}

