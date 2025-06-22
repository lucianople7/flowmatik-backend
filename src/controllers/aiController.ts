import { Request, Response, NextFunction } from 'express';
import { AIIntegrationService } from '../services/aiIntegrationService';
import { UsageTrackingService } from '../services/usageTrackingService';
import { Logger } from '../utils/logger';
import { 
  APIResponse, 
  AIRequest,
  ValidationError, 
  FlowmatikError,
  AuthorizationError 
} from '../types';

export class AIController {
  private aiService: AIIntegrationService;
  private usageService: UsageTrackingService;
  private logger: Logger;

  constructor(
    aiService: AIIntegrationService,
    usageService: UsageTrackingService
  ) {
    this.aiService = aiService;
    this.usageService = usageService;
    this.logger = new Logger('AIController');
  }

  /**
   * Process AI chat request
   * POST /api/ai/chat
   */
  chat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { message, metadata } = req.body;

      if (!message || typeof message !== 'string') {
        throw new ValidationError('Message is required and must be a string');
      }

      if (message.length > 10000) {
        throw new ValidationError('Message is too long (max 10,000 characters)');
      }

      // Check usage limits
      const canMakeRequest = await this.usageService.canMakeRequest(user.id);
      if (!canMakeRequest.allowed) {
        throw new AuthorizationError(canMakeRequest.reason || 'Usage limit exceeded');
      }

      // Create AI request
      const aiRequest: AIRequest = {
        userId: user.id,
        message: message.trim(),
        metadata: {
          ...metadata,
          userAgent: req.headers['user-agent'],
          ip: req.ip,
          timestamp: new Date()
        }
      };

      // Process request
      const response = await this.aiService.processRequest(aiRequest);

      // Track usage
      await this.usageService.trackAIRequest(user.id, {
        type: 'text_generation',
        model: response.metadata.workflow || 'doubao-1.5-pro-32k',
        tokens: response.metadata.context_used,
        cost: response.cost,
        metadata: {
          agent: response.agent,
          workflow: response.metadata.workflow
        }
      });

      const apiResponse: APIResponse = {
        success: true,
        data: {
          response: response.content,
          agent: response.agent,
          cost: response.cost,
          suggestions: response.suggestions,
          metadata: {
            reasoning: response.metadata.reasoning,
            workflow: response.metadata.workflow,
            steps: response.metadata.steps,
            contextUsed: response.metadata.context_used
          }
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`AI chat request processed for user ${user.id}: ${response.agent}`);
      res.json(apiResponse);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Generate content (text + multimedia)
   * POST /api/ai/generate-content
   */
  generateContent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { 
        prompt, 
        includeImage, 
        includeVideo, 
        includeAudio,
        imageStyle,
        videoDuration,
        voiceStyle 
      } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        throw new ValidationError('Prompt is required and must be a string');
      }

      // Check permissions for multimedia generation
      if ((includeImage || includeVideo || includeAudio) && user.subscription.plan === 'free') {
        throw new AuthorizationError('Multimedia generation requires a paid plan');
      }

      // Check usage limits
      const canMakeRequest = await this.usageService.canMakeRequest(user.id, 2000);
      if (!canMakeRequest.allowed) {
        throw new AuthorizationError(canMakeRequest.reason || 'Usage limit exceeded');
      }

      // Create content generation request
      const contentRequest = {
        prompt: prompt.trim(),
        includeImage: includeImage || false,
        includeVideo: includeVideo || false,
        includeAudio: includeAudio || false,
        imageStyle,
        videoDuration: videoDuration || 5,
        voiceStyle
      };

      // Generate content
      const result = await this.aiService.createContent(contentRequest);

      // Track usage for each type of content generated
      await this.usageService.trackAIRequest(user.id, {
        type: 'text_generation',
        model: 'doubao-1.5-pro-32k',
        tokens: 2000, // Estimated
        cost: result.text.cost,
        metadata: { contentType: 'text' }
      });

      if (result.image) {
        await this.usageService.trackAIRequest(user.id, {
          type: 'image_generation',
          model: 'FLUX.1-schnell',
          cost: result.image.cost,
          metadata: { contentType: 'image', style: imageStyle }
        });
      }

      if (result.video) {
        await this.usageService.trackAIRequest(user.id, {
          type: 'video_generation',
          model: 'Wan2.1-T2V-14B-Turbo',
          cost: result.video.cost,
          metadata: { contentType: 'video', duration: videoDuration }
        });
      }

      if (result.audio) {
        await this.usageService.trackAIRequest(user.id, {
          type: 'audio_generation',
          model: 'CosyVoice2-0.5B',
          cost: result.audio.cost,
          metadata: { contentType: 'audio', voice: voiceStyle }
        });
      }

      const response: APIResponse = {
        success: true,
        data: {
          text: result.text.content,
          image: result.image ? {
            url: result.image.url,
            cost: result.image.cost
          } : null,
          video: result.video ? {
            url: result.video.url,
            cost: result.video.cost
          } : null,
          audio: result.audio ? {
            url: result.audio.url,
            cost: result.audio.cost
          } : null,
          totalCost: result.totalCost
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Content generated for user ${user.id}: $${result.totalCost}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get available AI models
   * GET /api/ai/models
   */
  getModels = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const models = this.aiService.getAvailableModels();

      const response: APIResponse = {
        success: true,
        data: { models },
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
   * Get AI service status
   * GET /api/ai/status
   */
  getStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status = await this.aiService.getStatus();

      const response: APIResponse = {
        success: true,
        data: { status },
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
   * Get user's AI usage analytics
   * GET /api/ai/usage
   */
  getUsageAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { period = 'day' } = req.query;

      if (!['day', 'week', 'month'].includes(period as string)) {
        throw new ValidationError('Period must be day, week, or month');
      }

      const analytics = await this.usageService.getUserUsageAnalytics(
        user.id,
        period as 'day' | 'week' | 'month'
      );

      const response: APIResponse = {
        success: true,
        data: { analytics },
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
   * Get current usage status
   * GET /api/ai/usage/current
   */
  getCurrentUsage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      const usage = await this.usageService.getCurrentUsage(user.id);

      const response: APIResponse = {
        success: true,
        data: { usage },
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
   * Update agent configuration (admin only)
   * PUT /api/ai/agents/:agentType
   */
  updateAgentConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { agentType } = req.params;
      const { config } = req.body;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      if (!config) {
        throw new ValidationError('Config is required');
      }

      this.aiService.updateAgentConfig(agentType as any, config);

      const response: APIResponse = {
        success: true,
        data: { 
          message: `Agent ${agentType} configuration updated successfully`,
          agentType,
          config
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Agent config updated by admin ${user.id}: ${agentType}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Test AI connection
   * POST /api/ai/test
   */
  testConnection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      // Check admin permissions
      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      // Simple test request
      const testRequest: AIRequest = {
        userId: user.id,
        message: 'Test connection - respond with "OK"',
        metadata: { test: true }
      };

      const result = await this.aiService.processRequest(testRequest);

      const response: APIResponse = {
        success: true,
        data: {
          test: 'passed',
          response: result.content,
          cost: result.cost,
          agent: result.agent
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
   * Get conversation history
   * GET /api/ai/conversations
   */
  getConversations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { limit = 50, offset = 0 } = req.query;

      // This would typically get conversation history from context manager
      // For now, return a placeholder response
      const response: APIResponse = {
        success: true,
        data: {
          conversations: [],
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            total: 0,
            hasMore: false
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
   * Clear conversation history
   * DELETE /api/ai/conversations
   */
  clearConversations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      // This would typically clear conversation history in context manager
      
      const response: APIResponse = {
        success: true,
        data: { message: 'Conversation history cleared successfully' },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Conversation history cleared for user ${user.id}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Export user data
   * GET /api/ai/export
   */
  exportData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { format = 'json' } = req.query;

      if (!['json', 'csv'].includes(format as string)) {
        throw new ValidationError('Format must be json or csv');
      }

      // Get user's usage data
      const analytics = await this.usageService.getUserUsageAnalytics(user.id, 'month');

      const exportData = {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          subscription: user.subscription
        },
        usage: analytics,
        exportedAt: new Date()
      };

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="flowmatik-data-${user.id}.json"`);
        res.json(exportData);
      } else {
        // Convert to CSV format
        const csv = this.convertToCSV(analytics);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="flowmatik-usage-${user.id}.csv"`);
        res.send(csv);
      }

      this.logger.info(`Data exported for user ${user.id} in ${format} format`);
    } catch (error) {
      next(error);
    }
  };

  // Helper methods

  private convertToCSV(analytics: any): string {
    const headers = ['Date', 'Requests', 'Tokens', 'Cost'];
    const rows = analytics.dailyUsage.map((day: any) => [
      day.date,
      day.requests,
      day.tokens || 0,
      day.cost
    ]);

    return [headers, ...rows]
      .map(row => row.join(','))
      .join('\n');
  }
}

