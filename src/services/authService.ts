import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { User, AuthToken, Subscription } from '../types';
import { DatabaseService } from './databaseService';
import { CacheService } from './cacheService';
import { Logger } from '../utils/logger';
import { ValidationError, AuthenticationError, AuthorizationError } from '../types';

export class AuthService {
  private db: DatabaseService;
  private cache: CacheService;
  private logger: Logger;
  private jwtSecret: string;
  private jwtExpiresIn: string;
  private bcryptRounds: number;

  constructor(
    db: DatabaseService,
    cache: CacheService,
    config: {
      jwtSecret: string;
      jwtExpiresIn: string;
      bcryptRounds: number;
    }
  ) {
    this.db = db;
    this.cache = cache;
    this.logger = new Logger('AuthService');
    this.jwtSecret = config.jwtSecret;
    this.jwtExpiresIn = config.jwtExpiresIn;
    this.bcryptRounds = config.bcryptRounds;
  }

  /**
   * Register a new user
   */
  async register(userData: {
    email: string;
    password: string;
    name: string;
    referralCode?: string;
  }): Promise<{ user: User; token: string }> {
    const { email, password, name, referralCode } = userData;

    // Validate input
    this.validateEmail(email);
    this.validatePassword(password);
    this.validateName(name);

    // Check if user already exists
    const existingUser = await this.getUserByEmail(email);
    if (existingUser) {
      throw new ValidationError('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, this.bcryptRounds);

    // Create user in database
    const userId = await this.db.transaction(async (trx) => {
      // Insert user
      const [user] = await trx.query(
        `INSERT INTO users (email, password_hash, name, role, created_at, updated_at)
         VALUES (?, ?, ?, 'user', NOW(), NOW())
         RETURNING id`,
        [email, hashedPassword, name]
      );

      // Create default subscription (free plan)
      await trx.query(
        `INSERT INTO subscriptions (user_id, plan, status, current_period_start, current_period_end, created_at)
         VALUES (?, 'free', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR), NOW())`,
        [user.id]
      );

      // Initialize usage tracking
      await trx.query(
        `INSERT INTO usage_records (user_id, requests_today, tokens_today, cost_today, 
         requests_this_month, tokens_this_month, cost_this_month, created_at)
         VALUES (?, 0, 0, 0, 0, 0, 0, NOW())`,
        [user.id]
      );

      // Handle referral if provided
      if (referralCode) {
        await this.handleReferral(trx, user.id, referralCode);
      }

      return user.id;
    });

    // Get complete user data
    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error('Failed to create user');
    }

    // Generate JWT token
    const token = this.generateToken(user);

    // Cache user data
    await this.cache.set(`user:${user.id}`, user, 3600); // 1 hour

    this.logger.info(`User registered: ${email}`);

    return { user, token };
  }

  /**
   * Login user
   */
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    this.validateEmail(email);

    // Get user from database
    const [userRow] = await this.db.query(
      `SELECT u.*, s.plan, s.status as subscription_status, s.current_period_end,
              ur.requests_today, ur.tokens_today, ur.cost_today,
              ur.requests_this_month, ur.tokens_this_month, ur.cost_this_month
       FROM users u
       LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
       LEFT JOIN usage_records ur ON u.id = ur.user_id
       WHERE u.email = ? AND u.deleted_at IS NULL`,
      [email]
    );

    if (!userRow) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, userRow.password_hash);
    if (!isValidPassword) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Check if account is active
    if (userRow.status === 'suspended') {
      throw new AuthenticationError('Account is suspended');
    }

    // Build user object
    const user = this.buildUserObject(userRow);

    // Generate JWT token
    const token = this.generateToken(user);

    // Cache user data
    await this.cache.set(`user:${user.id}`, user, 3600);

    // Update last login
    await this.db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [user.id]
    );

    this.logger.info(`User logged in: ${email}`);

    return { user, token };
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<User> {
    try {
      // Remove 'Bearer ' prefix if present
      const cleanToken = token.replace(/^Bearer\s+/, '');

      // Verify JWT
      const decoded = jwt.verify(cleanToken, this.jwtSecret) as AuthToken;

      // Check if token is blacklisted
      const isBlacklisted = await this.cache.exists(`blacklist:${cleanToken}`);
      if (isBlacklisted) {
        throw new AuthenticationError('Token has been revoked');
      }

      // Try to get user from cache first
      let user = await this.cache.get<User>(`user:${decoded.userId}`);

      if (!user) {
        // Get user from database
        user = await this.getUserById(decoded.userId);
        if (!user) {
          throw new AuthenticationError('User not found');
        }

        // Cache user data
        await this.cache.set(`user:${user.id}`, user, 3600);
      }

      // Check if account is still active
      if (user.subscription.status === 'expired' || user.subscription.status === 'cancelled') {
        // Downgrade to free plan if subscription expired
        await this.downgradeToFreePlan(user.id);
        user.subscription.plan = 'free';
        user.subscription.status = 'active';
      }

      return user;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid token');
      }
      throw error;
    }
  }

  /**
   * Refresh user data
   */
  async refreshUser(userId: string): Promise<User> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new AuthenticationError('User not found');
    }

    // Update cache
    await this.cache.set(`user:${user.id}`, user, 3600);

    return user;
  }

  /**
   * Logout user (blacklist token)
   */
  async logout(token: string): Promise<void> {
    try {
      const cleanToken = token.replace(/^Bearer\s+/, '');
      const decoded = jwt.verify(cleanToken, this.jwtSecret) as AuthToken;

      // Calculate remaining TTL
      const now = Math.floor(Date.now() / 1000);
      const ttl = decoded.exp - now;

      if (ttl > 0) {
        // Blacklist token for remaining time
        await this.cache.set(`blacklist:${cleanToken}`, true, ttl);
      }

      // Remove user from cache
      await this.cache.del(`user:${decoded.userId}`);

      this.logger.info(`User logged out: ${decoded.userId}`);
    } catch (error) {
      // Token might be invalid, but that's okay for logout
      this.logger.warn('Logout with invalid token attempted');
    }
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    this.validatePassword(newPassword);

    // Get current password hash
    const [userRow] = await this.db.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );

    if (!userRow) {
      throw new AuthenticationError('User not found');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, userRow.password_hash);
    if (!isValidPassword) {
      throw new AuthenticationError('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptRounds);

    // Update password
    await this.db.query(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, userId]
    );

    // Invalidate user cache
    await this.cache.del(`user:${userId}`);

    this.logger.info(`Password changed for user: ${userId}`);
  }

  /**
   * Reset password
   */
  async requestPasswordReset(email: string): Promise<string> {
    const user = await this.getUserByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return 'If the email exists, a reset link has been sent';
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.id, type: 'password_reset' },
      this.jwtSecret,
      { expiresIn: '1h' }
    );

    // Store reset token in cache
    await this.cache.set(`reset:${resetToken}`, user.id, 3600); // 1 hour

    // TODO: Send email with reset link
    // await this.emailService.sendPasswordResetEmail(user.email, resetToken);

    this.logger.info(`Password reset requested for: ${email}`);

    return resetToken; // In production, don't return this
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    this.validatePassword(newPassword);

    try {
      // Verify reset token
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      
      if (decoded.type !== 'password_reset') {
        throw new AuthenticationError('Invalid reset token');
      }

      // Check if token is still valid in cache
      const userId = await this.cache.get(`reset:${token}`);
      if (!userId) {
        throw new AuthenticationError('Reset token has expired');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, this.bcryptRounds);

      // Update password
      await this.db.query(
        'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
        [hashedPassword, userId]
      );

      // Remove reset token
      await this.cache.del(`reset:${token}`);

      // Invalidate user cache
      await this.cache.del(`user:${userId}`);

      this.logger.info(`Password reset completed for user: ${userId}`);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid reset token');
      }
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    updates: {
      name?: string;
      preferences?: any;
    }
  ): Promise<User> {
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.name) {
      this.validateName(updates.name);
      updateFields.push('name = ?');
      updateValues.push(updates.name);
    }

    if (updates.preferences) {
      updateFields.push('preferences = ?');
      updateValues.push(JSON.stringify(updates.preferences));
    }

    if (updateFields.length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(userId);

    await this.db.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Invalidate cache and return fresh user data
    await this.cache.del(`user:${userId}`);
    const user = await this.getUserById(userId);

    if (!user) {
      throw new Error('Failed to update user');
    }

    this.logger.info(`Profile updated for user: ${userId}`);

    return user;
  }

  /**
   * Check user permissions
   */
  hasPermission(user: User, permission: string): boolean {
    const rolePermissions = {
      admin: ['*'], // Admin has all permissions
      premium: ['ai_request', 'file_upload', 'export_data', 'priority_support'],
      user: ['ai_request', 'basic_features']
    };

    const userPermissions = rolePermissions[user.role] || [];
    
    return userPermissions.includes('*') || userPermissions.includes(permission);
  }

  /**
   * Check subscription limits
   */
  async checkUsageLimits(userId: string): Promise<{
    canMakeRequest: boolean;
    remainingRequests: number;
    remainingTokens: number;
    resetDate: Date;
  }> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new AuthenticationError('User not found');
    }

    const planLimits = {
      free: { requests: 100, tokens: 50000 },
      starter: { requests: 1000, tokens: 500000 },
      pro: { requests: 10000, tokens: 5000000 },
      business: { requests: -1, tokens: -1 } // Unlimited
    };

    const limits = planLimits[user.subscription.plan];
    const usage = user.usage;

    const canMakeRequest = 
      limits.requests === -1 || usage.requestsToday < limits.requests;

    const remainingRequests = 
      limits.requests === -1 ? -1 : Math.max(0, limits.requests - usage.requestsToday);

    const remainingTokens = 
      limits.tokens === -1 ? -1 : Math.max(0, limits.tokens - usage.tokensToday);

    // Reset date is tomorrow at midnight
    const resetDate = new Date();
    resetDate.setDate(resetDate.getDate() + 1);
    resetDate.setHours(0, 0, 0, 0);

    return {
      canMakeRequest,
      remainingRequests,
      remainingTokens,
      resetDate
    };
  }

  // Private helper methods

  private generateToken(user: User): string {
    const payload: AuthToken = {
      userId: user.id,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.parseExpiresIn(this.jwtExpiresIn)
    };

    return jwt.sign(payload, this.jwtSecret);
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // Default 1 hour

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 3600;
    }
  }

  private async getUserById(id: string): Promise<User | null> {
    const [userRow] = await this.db.query(
      `SELECT u.*, s.plan, s.status as subscription_status, s.current_period_end,
              ur.requests_today, ur.tokens_today, ur.cost_today,
              ur.requests_this_month, ur.tokens_this_month, ur.cost_this_month
       FROM users u
       LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status IN ('active', 'past_due')
       LEFT JOIN usage_records ur ON u.id = ur.user_id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id]
    );

    return userRow ? this.buildUserObject(userRow) : null;
  }

  private async getUserByEmail(email: string): Promise<User | null> {
    const [userRow] = await this.db.query(
      `SELECT u.*, s.plan, s.status as subscription_status, s.current_period_end,
              ur.requests_today, ur.tokens_today, ur.cost_today,
              ur.requests_this_month, ur.tokens_this_month, ur.cost_this_month
       FROM users u
       LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status IN ('active', 'past_due')
       LEFT JOIN usage_records ur ON u.id = ur.user_id
       WHERE u.email = ? AND u.deleted_at IS NULL`,
      [email]
    );

    return userRow ? this.buildUserObject(userRow) : null;
  }

  private buildUserObject(row: any): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      subscription: {
        plan: row.plan || 'free',
        status: row.subscription_status || 'active',
        expiresAt: row.current_period_end ? new Date(row.current_period_end) : undefined
      },
      usage: {
        requestsToday: row.requests_today || 0,
        tokensToday: row.tokens_today || 0,
        costToday: row.cost_today || 0,
        requestsThisMonth: row.requests_this_month || 0,
        tokensThisMonth: row.tokens_this_month || 0,
        costThisMonth: row.cost_this_month || 0
      },
      preferences: row.preferences ? JSON.parse(row.preferences) : {},
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }
  }

  private validatePassword(password: string): void {
    if (!password || password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      throw new ValidationError('Password must contain at least one lowercase letter, one uppercase letter, and one number');
    }
  }

  private validateName(name: string): void {
    if (!name || name.trim().length < 2) {
      throw new ValidationError('Name must be at least 2 characters long');
    }
    if (name.length > 100) {
      throw new ValidationError('Name must be less than 100 characters');
    }
  }

  private async handleReferral(trx: any, userId: string, referralCode: string): Promise<void> {
    // Find referrer
    const [referrer] = await trx.query(
      'SELECT id FROM users WHERE referral_code = ?',
      [referralCode]
    );

    if (referrer) {
      // Record referral
      await trx.query(
        'INSERT INTO referrals (referrer_id, referred_id, created_at) VALUES (?, ?, NOW())',
        [referrer.id, userId]
      );

      // Give bonus to referrer (e.g., extra tokens or credits)
      await trx.query(
        'UPDATE usage_records SET bonus_tokens = bonus_tokens + 10000 WHERE user_id = ?',
        [referrer.id]
      );
    }
  }

  private async downgradeToFreePlan(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE subscriptions 
       SET plan = 'free', status = 'active', updated_at = NOW()
       WHERE user_id = ? AND status IN ('expired', 'cancelled')`,
      [userId]
    );
  }
}

