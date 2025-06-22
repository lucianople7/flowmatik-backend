import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { RateLimiter } from '../utils/rateLimiter';
import { Logger } from '../utils/logger';
import { 
  AuthenticationError, 
  AuthorizationError, 
  RateLimitError,
  ValidationError 
} from '../types';

export class AuthMiddleware {
  private authService: AuthService;
  private rateLimiter: RateLimiter;
  private logger: Logger;

  constructor(authService: AuthService) {
    this.authService = authService;
    this.rateLimiter = new RateLimiter();
    this.logger = new Logger('AuthMiddleware');
  }

  /**
   * Verify JWT token and attach user to request
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = this.extractToken(req);
      
      if (!token) {
        throw new AuthenticationError('Authentication token required');
      }

      // Verify token and get user
      const user = await this.authService.verifyToken(token);
      
      // Attach user to request
      (req as any).user = user;
      
      next();
    } catch (error) {
      this.handleAuthError(error, res);
    }
  };

  /**
   * Optional authentication - doesn't fail if no token
   */
  optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = this.extractToken(req);
      
      if (token) {
        try {
          const user = await this.authService.verifyToken(token);
          (req as any).user = user;
        } catch (error) {
          // Log but don't fail - just continue without user
          this.logger.warn('Optional auth failed:', error);
        }
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Require specific role
   */
  requireRole = (role: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const user = (req as any).user;
        
        if (!user) {
          throw new AuthenticationError('Authentication required');
        }

        if (user.role !== role && user.role !== 'admin') {
          throw new AuthorizationError(`${role} role required`);
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  };

  /**
   * Require any of the specified roles
   */
  requireAnyRole = (roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const user = (req as any).user;
        
        if (!user) {
          throw new AuthenticationError('Authentication required');
        }

        if (!roles.includes(user.role) && user.role !== 'admin') {
          throw new AuthorizationError(`One of these roles required: ${roles.join(', ')}`);
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  };

  /**
   * Require specific permission
   */
  requirePermission = (permission: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const user = (req as any).user;
        
        if (!user) {
          throw new AuthenticationError('Authentication required');
        }

        if (!this.authService.hasPermission(user, permission)) {
          throw new AuthorizationError(`Permission '${permission}' required`);
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  };

  /**
   * Check subscription plan
   */
  requirePlan = (plans: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const user = (req as any).user;
        
        if (!user) {
          throw new AuthenticationError('Authentication required');
        }

        if (!plans.includes(user.subscription.plan)) {
          throw new AuthorizationError(`One of these plans required: ${plans.join(', ')}`);
        }

        if (user.subscription.status !== 'active') {
          throw new AuthorizationError('Active subscription required');
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  };

  /**
   * Rate limiting middleware
   */
  rateLimit = (options: {
    max: number;
    window: number;
    keyGenerator?: (req: Request) => string;
    skipSuccessfulRequests?: boolean;
  }) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const key = options.keyGenerator 
          ? options.keyGenerator(req)
          : this.getDefaultRateLimitKey(req);

        const isAllowed = await this.rateLimiter.checkLimit(key, 'api_request', {
          max: options.max,
          window: options.window
        });

        if (!isAllowed) {
          throw new RateLimitError('Rate limit exceeded');
        }

        // Add rate limit info to response headers
        res.setHeader('X-RateLimit-Limit', options.max);
        res.setHeader('X-RateLimit-Window', options.window);

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  };

  /**
   * Usage-based rate limiting
   */
  usageRateLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      
      if (!user) {
        throw new AuthenticationError('Authentication required');
      }

      // Check usage limits
      const limits = await this.authService.checkUsageLimits(user.id);
      
      if (!limits.canMakeRequest) {
        throw new RateLimitError('Usage limit exceeded. Please upgrade your plan or wait for reset.');
      }

      // Add usage info to response headers
      res.setHeader('X-Usage-Remaining-Requests', limits.remainingRequests);
      res.setHeader('X-Usage-Remaining-Tokens', limits.remainingTokens);
      res.setHeader('X-Usage-Reset-Date', limits.resetDate.toISOString());

      next();
    } catch (error) {
      this.handleAuthError(error, res);
    }
  };

  /**
   * Validate request body
   */
  validateBody = (schema: any) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        // This would use a validation library like Joi or Zod
        // For now, just check if body exists when required
        if (schema.required && (!req.body || Object.keys(req.body).length === 0)) {
          throw new ValidationError('Request body is required');
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  };

  /**
   * CORS middleware
   */
  cors = (req: Request, res: Response, next: NextFunction): void => {
    const allowedOrigins = [
      'https://flowmatik.co',
      'https://admin.flowmatik.co',
      'http://localhost:3000',
      'http://localhost:3001'
    ];

    const origin = req.headers.origin;
    
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    next();
  };

  /**
   * Request ID middleware
   */
  requestId = (req: Request, res: Response, next: NextFunction): void => {
    const requestId = req.headers['x-request-id'] as string || this.generateRequestId();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  };

  /**
   * Security headers middleware
   */
  securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
  };

  /**
   * Webhook signature verification
   */
  verifyWebhookSignature = (provider: 'stripe' | 'lemonsqueezy') => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const signature = provider === 'stripe' 
          ? req.headers['stripe-signature']
          : req.headers['x-signature'];

        if (!signature) {
          throw new AuthenticationError(`Missing ${provider} signature`);
        }

        // Store raw body for signature verification
        (req as any).rawBody = req.body;
        
        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  };

  /**
   * Admin only middleware
   */
  adminOnly = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const user = (req as any).user;
      
      if (!user) {
        throw new AuthenticationError('Authentication required');
      }

      if (user.role !== 'admin') {
        throw new AuthorizationError('Admin access required');
      }

      next();
    } catch (error) {
      this.handleAuthError(error, res);
    }
  };

  /**
   * Premium features middleware
   */
  premiumOnly = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const user = (req as any).user;
      
      if (!user) {
        throw new AuthenticationError('Authentication required');
      }

      const premiumPlans = ['starter', 'pro', 'business'];
      
      if (!premiumPlans.includes(user.subscription.plan)) {
        throw new AuthorizationError('Premium subscription required');
      }

      if (user.subscription.status !== 'active') {
        throw new AuthorizationError('Active subscription required');
      }

      next();
    } catch (error) {
      this.handleAuthError(error, res);
    }
  };

  // Private helper methods

  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Also check for token in query params (for WebSocket upgrades)
    const queryToken = req.query.token as string;
    if (queryToken) {
      return queryToken;
    }

    return null;
  }

  private getDefaultRateLimitKey(req: Request): string {
    const user = (req as any).user;
    
    if (user) {
      return `user:${user.id}`;
    }

    // Fall back to IP address for unauthenticated requests
    return `ip:${req.ip}`;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private handleAuthError(error: any, res: Response): void {
    this.logger.warn('Authentication/Authorization error:', error);

    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (error instanceof AuthenticationError) {
      statusCode = 401;
      errorCode = 'AUTHENTICATION_ERROR';
      message = error.message;
    } else if (error instanceof AuthorizationError) {
      statusCode = 403;
      errorCode = 'AUTHORIZATION_ERROR';
      message = error.message;
    } else if (error instanceof RateLimitError) {
      statusCode = 429;
      errorCode = 'RATE_LIMIT_ERROR';
      message = error.message;
    } else if (error instanceof ValidationError) {
      statusCode = 400;
      errorCode = 'VALIDATION_ERROR';
      message = error.message;
    }

    res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message,
        details: error.details || null
      },
      metadata: {
        timestamp: new Date(),
        requestId: res.getHeader('X-Request-ID'),
        version: '1.0'
      }
    });
  }
}

