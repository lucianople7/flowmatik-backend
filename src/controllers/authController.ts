import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { Logger } from '../utils/logger';
import { 
  APIResponse, 
  ValidationError, 
  AuthenticationError,
  FlowmatikError 
} from '../types';
import { validateEmail, validatePassword, validateName } from '../utils/validators';

export class AuthController {
  private authService: AuthService;
  private logger: Logger;

  constructor(authService: AuthService) {
    this.authService = authService;
    this.logger = new Logger('AuthController');
  }

  /**
   * Register new user
   * POST /api/auth/register
   */
  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password, name, referralCode } = req.body;

      // Validate input
      if (!email || !password || !name) {
        throw new ValidationError('Email, password, and name are required');
      }

      validateEmail(email);
      validatePassword(password);
      validateName(name);

      // Register user
      const result = await this.authService.register({
        email: email.toLowerCase().trim(),
        password,
        name: name.trim(),
        referralCode
      });

      const response: APIResponse = {
        success: true,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
            subscription: result.user.subscription,
            createdAt: result.user.createdAt
          },
          token: result.token
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`User registered: ${email}`);
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Login user
   * POST /api/auth/login
   */
  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new ValidationError('Email and password are required');
      }

      validateEmail(email);

      // Login user
      const result = await this.authService.login(
        email.toLowerCase().trim(),
        password
      );

      const response: APIResponse = {
        success: true,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
            subscription: result.user.subscription,
            usage: result.user.usage,
            preferences: result.user.preferences
          },
          token: result.token
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`User logged in: ${email}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Logout user
   * POST /api/auth/logout
   */
  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.headers.authorization;

      if (token) {
        await this.authService.logout(token);
      }

      const response: APIResponse = {
        success: true,
        data: { message: 'Logged out successfully' },
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
   * Get current user profile
   * GET /api/auth/me
   */
  getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;

      // Refresh user data
      const user = await this.authService.refreshUser(userId);

      const response: APIResponse = {
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            subscription: user.subscription,
            usage: user.usage,
            preferences: user.preferences,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
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
   * Update user profile
   * PUT /api/auth/profile
   */
  updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { name, preferences } = req.body;

      const updates: any = {};

      if (name) {
        validateName(name);
        updates.name = name.trim();
      }

      if (preferences) {
        updates.preferences = preferences;
      }

      if (Object.keys(updates).length === 0) {
        throw new ValidationError('No valid fields to update');
      }

      const user = await this.authService.updateProfile(userId, updates);

      const response: APIResponse = {
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            subscription: user.subscription,
            usage: user.usage,
            preferences: user.preferences,
            updatedAt: user.updatedAt
          }
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Profile updated for user: ${userId}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Change password
   * POST /api/auth/change-password
   */
  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        throw new ValidationError('Current password and new password are required');
      }

      validatePassword(newPassword);

      await this.authService.changePassword(userId, currentPassword, newPassword);

      const response: APIResponse = {
        success: true,
        data: { message: 'Password changed successfully' },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Password changed for user: ${userId}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Request password reset
   * POST /api/auth/forgot-password
   */
  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email) {
        throw new ValidationError('Email is required');
      }

      validateEmail(email);

      await this.authService.requestPasswordReset(email.toLowerCase().trim());

      const response: APIResponse = {
        success: true,
        data: { 
          message: 'If the email exists, a password reset link has been sent' 
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
   * Reset password with token
   * POST /api/auth/reset-password
   */
  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        throw new ValidationError('Token and new password are required');
      }

      validatePassword(newPassword);

      await this.authService.resetPassword(token, newPassword);

      const response: APIResponse = {
        success: true,
        data: { message: 'Password reset successfully' },
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
   * Verify token
   * POST /api/auth/verify
   */
  verifyToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body;

      if (!token) {
        throw new ValidationError('Token is required');
      }

      const user = await this.authService.verifyToken(token);

      const response: APIResponse = {
        success: true,
        data: {
          valid: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            subscription: user.subscription
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
      const response: APIResponse = {
        success: true,
        data: { valid: false },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    }
  };

  /**
   * Get usage limits
   * GET /api/auth/limits
   */
  getUsageLimits = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;

      const limits = await this.authService.checkUsageLimits(userId);

      const response: APIResponse = {
        success: true,
        data: limits,
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
   * Refresh token
   * POST /api/auth/refresh
   */
  refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;

      // Get fresh user data
      const user = await this.authService.refreshUser(userId);

      // Generate new token
      const token = (this.authService as any).generateToken(user);

      const response: APIResponse = {
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            subscription: user.subscription,
            usage: user.usage,
            preferences: user.preferences
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
   * Check permissions
   * POST /api/auth/check-permission
   */
  checkPermission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { permission } = req.body;

      if (!permission) {
        throw new ValidationError('Permission is required');
      }

      const hasPermission = this.authService.hasPermission(user, permission);

      const response: APIResponse = {
        success: true,
        data: {
          permission,
          granted: hasPermission
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
   * Get user sessions (for security)
   * GET /api/auth/sessions
   */
  getSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;

      // This would typically get active sessions from cache/database
      // For now, return current session info
      const response: APIResponse = {
        success: true,
        data: {
          sessions: [
            {
              id: 'current',
              device: req.headers['user-agent'],
              ip: req.ip,
              lastActivity: new Date(),
              current: true
            }
          ]
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
   * Revoke session
   * DELETE /api/auth/sessions/:sessionId
   */
  revokeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;

      if (sessionId === 'current') {
        // Logout current session
        const token = req.headers.authorization;
        if (token) {
          await this.authService.logout(token);
        }
      }

      const response: APIResponse = {
        success: true,
        data: { message: 'Session revoked successfully' },
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
}

