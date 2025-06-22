import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { AIIntegrationService } from './aiIntegrationService';
import { AuthService } from './authService';
import { RateLimiter } from '../utils/rateLimiter';
import { Logger } from '../utils/logger';
import { AIRequest, StreamResponse } from '../types';

export class WebSocketService {
  private io: SocketIOServer;
  private aiService: AIIntegrationService;
  private authService: AuthService;
  private rateLimiter: RateLimiter;
  private logger: Logger;
  private activeConnections: Map<string, any> = new Map();
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(
    server: HTTPServer,
    aiService: AIIntegrationService,
    authService: AuthService
  ) {
    this.aiService = aiService;
    this.authService = authService;
    this.rateLimiter = new RateLimiter();
    this.logger = new Logger('WebSocketService');

    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupAIServiceEvents();
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
        
        if (!token) {
          return next(new Error('Authentication required'));
        }

        const user = await this.authService.verifyToken(token);
        socket.userId = user.id;
        socket.userRole = user.role;
        
        next();
      } catch (error) {
        next(new Error('Invalid authentication token'));
      }
    });

    // Rate limiting middleware
    this.io.use(async (socket, next) => {
      const isAllowed = await this.rateLimiter.checkLimit(
        socket.userId,
        'websocket_connection',
        { max: 5, window: 60000 } // 5 connections per minute
      );

      if (!isAllowed) {
        return next(new Error('Rate limit exceeded'));
      }

      next();
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: any): void {
    const userId = socket.userId;
    const socketId = socket.id;

    this.logger.info(`User ${userId} connected with socket ${socketId}`);

    // Track user connections
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);

    this.activeConnections.set(socketId, {
      userId,
      connectedAt: new Date(),
      lastActivity: new Date()
    });

    // Send connection confirmation
    socket.emit('connected', {
      socketId,
      timestamp: new Date(),
      features: ['streaming', 'real-time-updates', 'file-upload']
    });

    // Handle AI chat requests
    socket.on('ai_request', async (data) => {
      await this.handleAIRequest(socket, data);
    });

    // Handle streaming AI requests
    socket.on('ai_stream_request', async (data) => {
      await this.handleStreamingAIRequest(socket, data);
    });

    // Handle stop streaming
    socket.on('stop_stream', (data) => {
      this.handleStopStream(socket, data);
    });

    // Handle typing indicators
    socket.on('typing_start', () => {
      socket.broadcast.emit('user_typing', { userId, typing: true });
    });

    socket.on('typing_stop', () => {
      socket.broadcast.emit('user_typing', { userId, typing: false });
    });

    // Handle file upload progress
    socket.on('file_upload_progress', (data) => {
      this.handleFileUploadProgress(socket, data);
    });

    // Handle user preferences update
    socket.on('update_preferences', async (data) => {
      await this.handleUpdatePreferences(socket, data);
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date() });
      this.updateLastActivity(socketId);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(socket, reason);
    });

    // Handle errors
    socket.on('error', (error) => {
      this.logger.error(`Socket error for user ${userId}:`, error);
    });
  }

  private async handleAIRequest(socket: any, data: any): Promise<void> {
    try {
      // Rate limiting for AI requests
      const isAllowed = await this.rateLimiter.checkLimit(
        socket.userId,
        'ai_request',
        { max: 20, window: 60000 } // 20 requests per minute
      );

      if (!isAllowed) {
        socket.emit('error', {
          type: 'rate_limit',
          message: 'Too many requests. Please wait before sending another message.'
        });
        return;
      }

      this.updateLastActivity(socket.id);

      const request: AIRequest = {
        userId: socket.userId,
        message: data.message,
        metadata: {
          socketId: socket.id,
          timestamp: new Date(),
          ...data.metadata
        }
      };

      // Emit processing started
      socket.emit('ai_processing', {
        requestId: data.requestId,
        status: 'processing'
      });

      const response = await this.aiService.processRequest(request);

      // Emit response
      socket.emit('ai_response', {
        requestId: data.requestId,
        ...response,
        timestamp: new Date()
      });

      this.logger.info(`AI request processed for user ${socket.userId}`);

    } catch (error) {
      this.logger.error(`Error processing AI request for user ${socket.userId}:`, error);
      
      socket.emit('ai_error', {
        requestId: data.requestId,
        error: error.message,
        timestamp: new Date()
      });
    }
  }

  private async handleStreamingAIRequest(socket: any, data: any): Promise<void> {
    try {
      // Rate limiting for streaming requests
      const isAllowed = await this.rateLimiter.checkLimit(
        socket.userId,
        'ai_stream_request',
        { max: 10, window: 60000 } // 10 streaming requests per minute
      );

      if (!isAllowed) {
        socket.emit('error', {
          type: 'rate_limit',
          message: 'Too many streaming requests. Please wait.'
        });
        return;
      }

      this.updateLastActivity(socket.id);

      const request: AIRequest = {
        userId: socket.userId,
        message: data.message,
        metadata: {
          socketId: socket.id,
          requestId: data.requestId,
          timestamp: new Date(),
          ...data.metadata
        }
      };

      // Emit streaming started
      socket.emit('ai_stream_start', {
        requestId: data.requestId,
        timestamp: new Date()
      });

      const stream = this.aiService.processStreamingRequest(request);

      for await (const chunk of stream) {
        socket.emit('ai_stream_chunk', {
          requestId: data.requestId,
          ...chunk,
          timestamp: new Date()
        });

        if (chunk.finished) {
          socket.emit('ai_stream_end', {
            requestId: data.requestId,
            totalCost: chunk.cost,
            timestamp: new Date()
          });
          break;
        }
      }

      this.logger.info(`Streaming AI request completed for user ${socket.userId}`);

    } catch (error) {
      this.logger.error(`Error processing streaming AI request for user ${socket.userId}:`, error);
      
      socket.emit('ai_stream_error', {
        requestId: data.requestId,
        error: error.message,
        timestamp: new Date()
      });
    }
  }

  private handleStopStream(socket: any, data: any): void {
    try {
      const stopped = this.aiService.stopStream(data.streamId);
      
      socket.emit('stream_stopped', {
        streamId: data.streamId,
        stopped,
        timestamp: new Date()
      });

      this.logger.info(`Stream ${data.streamId} stop requested by user ${socket.userId}`);
    } catch (error) {
      this.logger.error(`Error stopping stream for user ${socket.userId}:`, error);
    }
  }

  private handleFileUploadProgress(socket: any, data: any): void {
    // Broadcast file upload progress to user's other sessions
    const userSockets = this.userSockets.get(socket.userId);
    if (userSockets) {
      userSockets.forEach(socketId => {
        if (socketId !== socket.id) {
          this.io.to(socketId).emit('file_upload_progress', {
            ...data,
            fromSocket: socket.id
          });
        }
      });
    }
  }

  private async handleUpdatePreferences(socket: any, data: any): Promise<void> {
    try {
      // Update user preferences in the context manager
      // This would typically involve calling a user service
      
      socket.emit('preferences_updated', {
        preferences: data.preferences,
        timestamp: new Date()
      });

      this.logger.info(`Preferences updated for user ${socket.userId}`);
    } catch (error) {
      this.logger.error(`Error updating preferences for user ${socket.userId}:`, error);
      
      socket.emit('error', {
        type: 'preferences_update_failed',
        message: 'Failed to update preferences'
      });
    }
  }

  private handleDisconnection(socket: any, reason: string): void {
    const userId = socket.userId;
    const socketId = socket.id;

    this.logger.info(`User ${userId} disconnected (${reason})`);

    // Remove from tracking
    this.activeConnections.delete(socketId);
    
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.delete(socketId);
      if (userSockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    // Stop any active streams for this socket
    // This would involve checking for active streams and stopping them
  }

  private updateLastActivity(socketId: string): void {
    const connection = this.activeConnections.get(socketId);
    if (connection) {
      connection.lastActivity = new Date();
    }
  }

  private setupAIServiceEvents(): void {
    // Listen to AI service events and broadcast to relevant users
    this.aiService.on('workflowProgress', (data) => {
      // Broadcast workflow progress to relevant users
      this.broadcastToUser(data.userId, 'workflow_progress', data);
    });

    this.aiService.on('workflowCompleted', (data) => {
      this.broadcastToUser(data.userId, 'workflow_completed', data);
    });

    this.aiService.on('rateLimitExceeded', (data) => {
      // Notify all connected users about rate limit issues
      this.io.emit('system_notification', {
        type: 'rate_limit_warning',
        message: 'System experiencing high load. Responses may be slower.',
        timestamp: new Date()
      });
    });

    this.aiService.on('apiError', (error) => {
      // Notify administrators about API errors
      this.broadcastToRole('admin', 'system_error', {
        type: 'api_error',
        error: error.message,
        timestamp: new Date()
      });
    });
  }

  /**
   * Broadcast message to all sockets of a specific user
   */
  private broadcastToUser(userId: string, event: string, data: any): void {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.forEach(socketId => {
        this.io.to(socketId).emit(event, data);
      });
    }
  }

  /**
   * Broadcast message to all users with a specific role
   */
  private broadcastToRole(role: string, event: string, data: any): void {
    this.activeConnections.forEach((connection, socketId) => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket && socket.userRole === role) {
        socket.emit(event, data);
      }
    });
  }

  /**
   * Send system-wide notification
   */
  public broadcastSystemNotification(message: string, type: string = 'info'): void {
    this.io.emit('system_notification', {
      type,
      message,
      timestamp: new Date()
    });
  }

  /**
   * Get connection statistics
   */
  public getConnectionStats(): {
    totalConnections: number;
    uniqueUsers: number;
    averageConnectionTime: number;
    connectionsPerUser: Record<string, number>;
  } {
    const now = new Date();
    let totalConnectionTime = 0;
    const connectionsPerUser: Record<string, number> = {};

    this.activeConnections.forEach((connection) => {
      const connectionTime = now.getTime() - connection.connectedAt.getTime();
      totalConnectionTime += connectionTime;

      connectionsPerUser[connection.userId] = (connectionsPerUser[connection.userId] || 0) + 1;
    });

    return {
      totalConnections: this.activeConnections.size,
      uniqueUsers: this.userSockets.size,
      averageConnectionTime: this.activeConnections.size > 0 
        ? totalConnectionTime / this.activeConnections.size 
        : 0,
      connectionsPerUser
    };
  }

  /**
   * Disconnect user sessions
   */
  public disconnectUser(userId: string, reason: string = 'Admin action'): number {
    const userSockets = this.userSockets.get(userId);
    let disconnectedCount = 0;

    if (userSockets) {
      userSockets.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
          disconnectedCount++;
        }
      });
    }

    return disconnectedCount;
  }

  /**
   * Send direct message to user
   */
  public sendToUser(userId: string, event: string, data: any): boolean {
    const userSockets = this.userSockets.get(userId);
    if (userSockets && userSockets.size > 0) {
      this.broadcastToUser(userId, event, data);
      return true;
    }
    return false;
  }
}

