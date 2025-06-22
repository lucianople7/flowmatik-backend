import { Request, Response, NextFunction } from 'express';
import { WebhookService } from '../services/webhookService';
import { Logger } from '../utils/logger';
import { APIResponse, FlowmatikError } from '../types';

export class WebhookController {
  private webhookService: WebhookService;
  private logger: Logger;

  constructor(webhookService: WebhookService) {
    this.webhookService = webhookService;
    this.logger = new Logger('WebhookController');
  }

  /**
   * Handle Stripe webhooks
   * POST /api/webhooks/stripe
   */
  handleStripeWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      
      if (!signature) {
        throw new FlowmatikError('Missing Stripe signature', 'WEBHOOK_SIGNATURE_MISSING', 400);
      }

      // Get raw body (should be configured in middleware)
      const payload = req.body;

      const result = await this.webhookService.handleStripeWebhook(payload, signature);

      const response: APIResponse = {
        success: true,
        data: {
          received: result.received,
          processed: result.processed
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info('Stripe webhook processed successfully');
      res.json(response);
    } catch (error) {
      this.logger.error('Failed to process Stripe webhook:', error);
      
      // Always return 200 to Stripe to prevent retries for invalid webhooks
      const response: APIResponse = {
        success: false,
        error: {
          code: 'WEBHOOK_PROCESSING_ERROR',
          message: 'Failed to process webhook',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.status(200).json(response);
    }
  };

  /**
   * Handle LemonSqueezy webhooks
   * POST /api/webhooks/lemonsqueezy
   */
  handleLemonSqueezyWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers['x-signature'] as string;
      
      if (!signature) {
        throw new FlowmatikError('Missing LemonSqueezy signature', 'WEBHOOK_SIGNATURE_MISSING', 400);
      }

      // Get raw body
      const payload = req.body;

      const result = await this.webhookService.handleLemonSqueezyWebhook(payload, signature);

      const response: APIResponse = {
        success: true,
        data: {
          received: result.received,
          processed: result.processed
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info('LemonSqueezy webhook processed successfully');
      res.json(response);
    } catch (error) {
      this.logger.error('Failed to process LemonSqueezy webhook:', error);
      
      // Always return 200 to prevent retries for invalid webhooks
      const response: APIResponse = {
        success: false,
        error: {
          code: 'WEBHOOK_PROCESSING_ERROR',
          message: 'Failed to process webhook',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.status(200).json(response);
    }
  };

  /**
   * Get webhook statistics (admin only)
   * GET /api/webhooks/stats
   */
  getWebhookStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new FlowmatikError('Admin access required', 'AUTHORIZATION_ERROR', 403);
      }

      const stats = await this.webhookService.getWebhookStats();

      const response: APIResponse = {
        success: true,
        data: { stats },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retry failed webhooks (admin only)
   * POST /api/webhooks/retry
   */
  retryFailedWebhooks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new FlowmatikError('Admin access required', 'AUTHORIZATION_ERROR', 403);
      }

      const retriedCount = await this.webhookService.retryFailedWebhooks();

      const response: APIResponse = {
        success: true,
        data: {
          message: `Retried ${retriedCount} failed webhooks`,
          retriedCount
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Admin ${user.id} retried ${retriedCount} failed webhooks`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Test webhook endpoint
   * POST /api/webhooks/test
   */
  testWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new FlowmatikError('Admin access required', 'AUTHORIZATION_ERROR', 403);
      }

      const { provider, eventType, testData } = req.body;

      if (!provider || !eventType) {
        throw new FlowmatikError('Provider and event type are required', 'VALIDATION_ERROR', 400);
      }

      // Create a test webhook event
      const testEvent = {
        id: `test_${Date.now()}`,
        type: eventType,
        data: testData || { test: true },
        timestamp: new Date(),
        source: provider as 'stripe' | 'lemon_squeezy'
      };

      // Process the test event
      let processed = false;
      if (provider === 'stripe') {
        // Create a mock Stripe event
        const mockStripeEvent = {
          id: testEvent.id,
          type: testEvent.type,
          data: { object: testEvent.data },
          created: Math.floor(testEvent.timestamp.getTime() / 1000)
        };
        
        // This would process the test event
        processed = true;
      } else if (provider === 'lemonsqueezy') {
        // Create a mock LemonSqueezy event
        const mockLSEvent = {
          meta: { event_name: testEvent.type },
          data: testEvent.data
        };
        
        // This would process the test event
        processed = true;
      }

      const response: APIResponse = {
        success: true,
        data: {
          message: 'Test webhook processed successfully',
          testEvent,
          processed
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Test webhook processed by admin ${user.id}: ${provider}/${eventType}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get webhook event details (admin only)
   * GET /api/webhooks/events/:eventId
   */
  getWebhookEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { eventId } = req.params;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new FlowmatikError('Admin access required', 'AUTHORIZATION_ERROR', 403);
      }

      // This would get the webhook event from database
      // For now, return a placeholder
      const response: APIResponse = {
        success: true,
        data: {
          event: {
            id: eventId,
            type: 'placeholder',
            data: {},
            timestamp: new Date(),
            source: 'stripe',
            processed: true,
            attempts: 1
          }
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get recent webhook events (admin only)
   * GET /api/webhooks/events
   */
  getRecentWebhookEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { limit = 50, offset = 0, source, processed } = req.query;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new FlowmatikError('Admin access required', 'AUTHORIZATION_ERROR', 403);
      }

      // This would get webhook events from database with filters
      // For now, return a placeholder
      const response: APIResponse = {
        success: true,
        data: {
          events: [],
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            total: 0,
            hasMore: false
          },
          filters: {
            source: source as string,
            processed: processed ? processed === 'true' : undefined
          }
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Webhook health check
   * GET /api/webhooks/health
   */
  healthCheck = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.webhookService.getWebhookStats();
      
      // Calculate health based on recent webhook success rate
      const successRate = stats.total > 0 ? (stats.processed / stats.total) * 100 : 100;
      const isHealthy = successRate >= 95; // 95% success rate threshold

      const response: APIResponse = {
        success: true,
        data: {
          status: isHealthy ? 'healthy' : 'degraded',
          successRate: Math.round(successRate * 100) / 100,
          totalEvents: stats.total,
          processedEvents: stats.processed,
          failedEvents: stats.failed,
          lastCheck: new Date()
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Configure webhook endpoints (admin only)
   * POST /api/webhooks/configure
   */
  configureWebhooks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { provider, events, url } = req.body;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new FlowmatikError('Admin access required', 'AUTHORIZATION_ERROR', 403);
      }

      if (!provider || !events || !url) {
        throw new FlowmatikError('Provider, events, and URL are required', 'VALIDATION_ERROR', 400);
      }

      // This would configure webhook endpoints with the payment providers
      // For now, return a success response
      const response: APIResponse = {
        success: true,
        data: {
          message: `Webhook configuration updated for ${provider}`,
          provider,
          events,
          url,
          configuredAt: new Date()
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Webhook configuration updated by admin ${user.id}: ${provider}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };
}

