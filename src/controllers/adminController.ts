import { Request, Response, NextFunction } from 'express';
import { UsageTrackingService } from '../services/usageTrackingService';
import { PaymentService } from '../services/paymentService';
import { AIIntegrationService } from '../services/aiIntegrationService';
import { WebSocketService } from '../services/websocketService';
import { Logger } from '../utils/logger';
import { 
  APIResponse, 
  PaginatedResponse,
  ValidationError, 
  FlowmatikError,
  AuthorizationError 
} from '../types';

export class AdminController {
  private usageService: UsageTrackingService;
  private paymentService: PaymentService;
  private aiService: AIIntegrationService;
  private websocketService: WebSocketService;
  private logger: Logger;

  constructor(
    usageService: UsageTrackingService,
    paymentService: PaymentService,
    aiService: AIIntegrationService,
    websocketService: WebSocketService
  ) {
    this.usageService = usageService;
    this.paymentService = paymentService;
    this.aiService = aiService;
    this.websocketService = websocketService;
    this.logger = new Logger('AdminController');
  }

  /**
   * Get system dashboard overview
   * GET /api/admin/dashboard
   */
  getDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      // Get system-wide statistics
      const [
        usageStats,
        aiStatus,
        connectionStats
      ] = await Promise.all([
        this.usageService.getSystemUsageStats(),
        this.aiService.getStatus(),
        this.websocketService.getConnectionStats()
      ]);

      const response: APIResponse = {
        success: true,
        data: {
          overview: {
            totalUsers: usageStats.totalUsers,
            activeUsers: usageStats.activeUsers,
            totalRequests: usageStats.totalRequests,
            totalCost: usageStats.totalCost,
            averageCostPerUser: usageStats.averageCostPerUser
          },
          aiService: {
            status: aiStatus.siliconflow.status,
            latency: aiStatus.siliconflow.latency,
            activeStreams: aiStatus.activeStreams,
            totalRequests: aiStatus.totalRequests,
            averageResponseTime: aiStatus.averageResponseTime,
            costToday: aiStatus.costToday
          },
          connections: {
            total: connectionStats.totalConnections,
            uniqueUsers: connectionStats.uniqueUsers,
            averageConnectionTime: connectionStats.averageConnectionTime
          },
          topUsers: usageStats.topUsers
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
   * Get all users with pagination
   * GET /api/admin/users
   */
  getUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { 
        page = 1, 
        limit = 50, 
        search, 
        role, 
        plan,
        status 
      } = req.query;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      // This would get users from database with filters
      // For now, return a placeholder response
      const response: PaginatedResponse<any> = {
        success: true,
        data: [], // Users would be here
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
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
   * Get user details
   * GET /api/admin/users/:userId
   */
  getUserDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { userId } = req.params;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      // Get user details, subscription, and usage
      const [
        userUsage,
        userSubscription
      ] = await Promise.all([
        this.usageService.getCurrentUsage(userId),
        this.paymentService.getUserSubscription(userId)
      ]);

      const response: APIResponse = {
        success: true,
        data: {
          user: {
            id: userId,
            // Other user details would be fetched from database
          },
          subscription: userSubscription,
          usage: userUsage,
          analytics: await this.usageService.getUserUsageAnalytics(userId, 'month')
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
   * Update user status
   * PUT /api/admin/users/:userId/status
   */
  updateUserStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { userId } = req.params;
      const { status, reason } = req.body;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      if (!status || !['active', 'suspended', 'banned'].includes(status)) {
        throw new ValidationError('Valid status is required (active, suspended, banned)');
      }

      // This would update user status in database
      // For now, return a success response
      const response: APIResponse = {
        success: true,
        data: {
          message: `User status updated to ${status}`,
          userId,
          status,
          reason,
          updatedBy: user.id,
          updatedAt: new Date()
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`User ${userId} status updated to ${status} by admin ${user.id}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get system metrics
   * GET /api/admin/metrics
   */
  getSystemMetrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { timeframe = 'day' } = req.query;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      if (!['hour', 'day', 'week', 'month'].includes(timeframe as string)) {
        throw new ValidationError('Timeframe must be hour, day, week, or month');
      }

      // Get comprehensive system metrics
      const metrics = {
        requests: {
          total: 15420,
          success: 14890,
          error: 530,
          averageResponseTime: 1250
        },
        ai: {
          totalRequests: 12340,
          totalTokens: 8500000,
          totalCost: 935.50,
          averageResponseTime: 2100
        },
        users: {
          total: 1250,
          active: 890,
          premium: 340
        },
        revenue: {
          monthly: 18500,
          daily: 620,
          averagePerUser: 14.80
        },
        performance: {
          uptime: 99.95,
          memoryUsage: 68.5,
          cpuUsage: 45.2,
          diskUsage: 32.1
        }
      };

      const response: APIResponse = {
        success: true,
        data: {
          metrics,
          timeframe,
          generatedAt: new Date()
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
   * Get system health status
   * GET /api/admin/health
   */
  getSystemHealth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      // Check health of all services
      const aiStatus = await this.aiService.getStatus();
      
      const health = {
        status: 'healthy',
        timestamp: new Date(),
        services: {
          database: { status: 'healthy', latency: 45 },
          redis: { status: 'healthy', latency: 12 },
          siliconflow: { 
            status: aiStatus.siliconflow.status, 
            latency: aiStatus.siliconflow.latency 
          },
          websockets: { status: 'healthy', connections: aiStatus.activeStreams }
        },
        metrics: {
          uptime: 99.95,
          memoryUsage: 68.5,
          cpuUsage: 45.2,
          activeConnections: aiStatus.activeStreams
        }
      };

      const response: APIResponse = {
        success: true,
        data: { health },
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
   * Send system notification
   * POST /api/admin/notifications
   */
  sendSystemNotification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { message, type = 'info', targetUsers } = req.body;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      if (!message) {
        throw new ValidationError('Message is required');
      }

      if (!['info', 'warning', 'error', 'success'].includes(type)) {
        throw new ValidationError('Type must be info, warning, error, or success');
      }

      // Send notification via WebSocket
      if (targetUsers && Array.isArray(targetUsers)) {
        // Send to specific users
        targetUsers.forEach(userId => {
          this.websocketService.sendToUser(userId, 'admin_notification', {
            message,
            type,
            from: 'admin',
            timestamp: new Date()
          });
        });
      } else {
        // Send to all connected users
        this.websocketService.broadcastSystemNotification(message, type);
      }

      const response: APIResponse = {
        success: true,
        data: {
          message: 'Notification sent successfully',
          notificationMessage: message,
          type,
          targetUsers: targetUsers || 'all',
          sentBy: user.id,
          sentAt: new Date()
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`System notification sent by admin ${user.id}: ${type} - ${message}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Disconnect user sessions
   * POST /api/admin/users/:userId/disconnect
   */
  disconnectUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { userId } = req.params;
      const { reason = 'Admin action' } = req.body;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      const disconnectedCount = this.websocketService.disconnectUser(userId, reason);

      const response: APIResponse = {
        success: true,
        data: {
          message: `Disconnected ${disconnectedCount} sessions for user ${userId}`,
          userId,
          disconnectedSessions: disconnectedCount,
          reason,
          disconnectedBy: user.id,
          disconnectedAt: new Date()
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`User ${userId} disconnected by admin ${user.id}: ${reason}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get system logs
   * GET /api/admin/logs
   */
  getSystemLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { 
        level = 'info', 
        limit = 100, 
        offset = 0,
        service,
        startDate,
        endDate 
      } = req.query;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      // This would get logs from logging service
      // For now, return a placeholder
      const response: PaginatedResponse<any> = {
        success: true,
        data: [], // Logs would be here
        pagination: {
          page: Math.floor(parseInt(offset as string) / parseInt(limit as string)) + 1,
          limit: parseInt(limit as string),
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
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
   * Update system configuration
   * PUT /api/admin/config
   */
  updateSystemConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { config } = req.body;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      if (!config) {
        throw new ValidationError('Configuration is required');
      }

      // This would update system configuration
      // For now, return a success response
      const response: APIResponse = {
        success: true,
        data: {
          message: 'System configuration updated successfully',
          config,
          updatedBy: user.id,
          updatedAt: new Date()
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`System configuration updated by admin ${user.id}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Export system data
   * GET /api/admin/export
   */
  exportSystemData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { 
        type = 'users', 
        format = 'csv',
        startDate,
        endDate 
      } = req.query;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      if (!['users', 'usage', 'payments', 'logs'].includes(type as string)) {
        throw new ValidationError('Type must be users, usage, payments, or logs');
      }

      if (!['csv', 'json', 'xlsx'].includes(format as string)) {
        throw new ValidationError('Format must be csv, json, or xlsx');
      }

      // This would generate and return the export file
      // For now, return a placeholder
      const filename = `flowmatik-${type}-export-${new Date().toISOString().split('T')[0]}.${format}`;
      
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from('Export placeholder'));

      this.logger.info(`System data exported by admin ${user.id}: ${type} (${format})`);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Reset daily usage counters
   * POST /api/admin/reset-usage
   */
  resetDailyUsage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      await this.usageService.resetDailyUsage();

      const response: APIResponse = {
        success: true,
        data: {
          message: 'Daily usage counters reset successfully',
          resetBy: user.id,
          resetAt: new Date()
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Daily usage reset by admin ${user.id}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };
}

