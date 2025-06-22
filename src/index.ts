import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { config } from './config';
import { Logger } from './utils/logger';
import { DatabaseService } from './services/databaseService';
import { CacheService } from './services/cacheService';
import { AuthService } from './services/authService';
import { AIIntegrationService } from './services/aiIntegrationService';
import { PaymentService } from './services/paymentService';
import { UsageTrackingService } from './services/usageTrackingService';
import { WebhookService } from './services/webhookService';
import { WebSocketService } from './services/websocketService';
import { ContextManager } from './services/contextManager';
import { AgentManager } from './services/agentManager';
import { ReasoningEngine } from './services/reasoningEngine';

// Controllers
import { AuthController } from './controllers/authController';
import { AIController } from './controllers/aiController';
import { PaymentController } from './controllers/paymentController';
import { WebhookController } from './controllers/webhookController';
import { AdminController } from './controllers/adminController';

// Middleware
import { AuthMiddleware } from './middleware/authMiddleware';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

// Routes
import { createAuthRoutes } from './routes/authRoutes';
import { createAIRoutes } from './routes/aiRoutes';
import { createPaymentRoutes } from './routes/paymentRoutes';
import { createWebhookRoutes } from './routes/webhookRoutes';
import { createAdminRoutes } from './routes/adminRoutes';

class FlowmatikApp {
  private app: express.Application;
  private server: any;
  private logger: Logger;
  private services: any = {};
  private controllers: any = {};
  private middleware: any = {};

  constructor() {
    this.app = express();
    this.logger = new Logger('FlowmatikApp');
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Flowmatik Backend...');

      // Initialize services
      await this.initializeServices();

      // Initialize controllers
      this.initializeControllers();

      // Initialize middleware
      this.initializeMiddleware();

      // Setup Express app
      this.setupExpress();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      // Initialize WebSocket
      this.initializeWebSocket();

      this.logger.info('Flowmatik Backend initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Flowmatik Backend:', error);
      throw error;
    }
  }

  private async initializeServices(): Promise<void> {
    this.logger.info('Initializing services...');

    // Database service
    this.services.database = new DatabaseService(config.database);
    await this.services.database.connect();

    // Cache service
    this.services.cache = new CacheService(config.redis);
    await this.services.cache.connect();

    // Auth service
    this.services.auth = new AuthService(
      this.services.database,
      this.services.cache,
      config.auth
    );

    // MCP services
    this.services.contextManager = new ContextManager(
      this.services.database,
      this.services.cache
    );

    this.services.agentManager = new AgentManager();

    this.services.reasoningEngine = new ReasoningEngine(
      this.services.contextManager,
      this.services.agentManager
    );

    // AI integration service
    this.services.aiIntegration = new AIIntegrationService(
      config.siliconflow,
      this.services.contextManager,
      this.services.agentManager,
      this.services.reasoningEngine
    );

    // Usage tracking service
    this.services.usageTracking = new UsageTrackingService(
      this.services.database,
      this.services.cache
    );

    // Payment service
    this.services.payment = new PaymentService(
      this.services.database,
      config.payments
    );

    // Webhook service
    this.services.webhook = new WebhookService(
      this.services.database,
      this.services.payment,
      {
        stripeWebhookSecret: config.payments.stripe.webhookSecret,
        lemonSqueezyWebhookSecret: config.payments.lemonSqueezy.webhookSecret
      }
    );

    this.logger.info('Services initialized successfully');
  }

  private initializeControllers(): void {
    this.logger.info('Initializing controllers...');

    this.controllers.auth = new AuthController(this.services.auth);
    this.controllers.ai = new AIController(
      this.services.aiIntegration,
      this.services.usageTracking
    );
    this.controllers.payment = new PaymentController(
      this.services.payment,
      this.services.usageTracking
    );
    this.controllers.webhook = new WebhookController(this.services.webhook);
    this.controllers.admin = new AdminController(
      this.services.usageTracking,
      this.services.payment,
      this.services.aiIntegration,
      this.services.websocket // Will be initialized later
    );

    this.logger.info('Controllers initialized successfully');
  }

  private initializeMiddleware(): void {
    this.logger.info('Initializing middleware...');

    this.middleware.auth = new AuthMiddleware(this.services.auth);

    this.logger.info('Middleware initialized successfully');
  }

  private setupExpress(): void {
    this.logger.info('Setting up Express application...');

    // Trust proxy for accurate IP addresses
    this.app.set('trust proxy', 1);

    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "https:"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    }));

    // CORS
    this.app.use(this.middleware.auth.cors);

    // Compression
    this.app.use(compression());

    // Request ID
    this.app.use(this.middleware.auth.requestId);

    // Request logging
    this.app.use(requestLogger);

    // Body parsing
    this.app.use('/api/webhooks', express.raw({ type: 'application/json' }));
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date(),
        version: process.env.npm_package_version || '1.0.0',
        environment: config.nodeEnv
      });
    });

    // API info endpoint
    this.app.get('/api', (req, res) => {
      res.json({
        name: 'Flowmatik API',
        version: '1.0.0',
        description: 'Advanced AI-powered content creation platform',
        documentation: '/api/docs',
        status: 'operational',
        timestamp: new Date()
      });
    });

    this.logger.info('Express application setup completed');
  }

  private setupRoutes(): void {
    this.logger.info('Setting up routes...');

    // API routes
    this.app.use('/api/auth', createAuthRoutes(
      this.controllers.auth,
      this.middleware.auth
    ));

    this.app.use('/api/ai', createAIRoutes(
      this.controllers.ai,
      this.middleware.auth
    ));

    this.app.use('/api/payments', createPaymentRoutes(
      this.controllers.payment,
      this.middleware.auth
    ));

    this.app.use('/api/webhooks', createWebhookRoutes(
      this.controllers.webhook,
      this.middleware.auth
    ));

    this.app.use('/api/admin', createAdminRoutes(
      this.controllers.admin,
      this.middleware.auth
    ));

    // 404 handler for API routes
    this.app.use('/api/*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'ENDPOINT_NOT_FOUND',
          message: `Endpoint ${req.method} ${req.path} not found`,
          details: null
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'],
          version: '1.0'
        }
      });
    });

    this.logger.info('Routes setup completed');
  }

  private setupErrorHandling(): void {
    this.logger.info('Setting up error handling...');

    // Global error handler
    this.app.use(errorHandler);

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    // Uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    this.logger.info('Error handling setup completed');
  }

  private initializeWebSocket(): void {
    this.logger.info('Initializing WebSocket service...');

    this.server = createServer(this.app);

    this.services.websocket = new WebSocketService(
      this.server,
      this.services.aiIntegration,
      this.services.auth
    );

    // Update admin controller with websocket service
    this.controllers.admin = new AdminController(
      this.services.usageTracking,
      this.services.payment,
      this.services.aiIntegration,
      this.services.websocket
    );

    this.logger.info('WebSocket service initialized successfully');
  }

  async start(): Promise<void> {
    try {
      const port = config.port;

      this.server.listen(port, () => {
        this.logger.info(`🚀 Flowmatik Backend started successfully!`);
        this.logger.info(`📡 Server running on port ${port}`);
        this.logger.info(`🌍 Environment: ${config.nodeEnv}`);
        this.logger.info(`🔗 API Base URL: http://localhost:${port}/api`);
        this.logger.info(`📚 Health Check: http://localhost:${port}/health`);
        this.logger.info(`⚡ WebSocket: ws://localhost:${port}`);
      });

      // Graceful shutdown
      this.setupGracefulShutdown();

    } catch (error) {
      this.logger.error('Failed to start server:', error);
      throw error;
    }
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}. Starting graceful shutdown...`);

      try {
        // Close server
        if (this.server) {
          await new Promise<void>((resolve) => {
            this.server.close(() => {
              this.logger.info('HTTP server closed');
              resolve();
            });
          });
        }

        // Close database connections
        if (this.services.database) {
          await this.services.database.close();
          this.logger.info('Database connections closed');
        }

        // Close cache connections
        if (this.services.cache) {
          await this.services.cache.close();
          this.logger.info('Cache connections closed');
        }

        this.logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  getApp(): express.Application {
    return this.app;
  }

  getServer(): any {
    return this.server;
  }
}

// Create and export app instance
const flowmatikApp = new FlowmatikApp();

export default flowmatikApp;

// Start the application if this file is run directly
if (require.main === module) {
  (async () => {
    try {
      await flowmatikApp.initialize();
      await flowmatikApp.start();
    } catch (error) {
      console.error('Failed to start Flowmatik Backend:', error);
      process.exit(1);
    }
  })();
}

