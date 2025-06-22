import { DatabaseService } from './databaseService';
import { CacheService } from './cacheService';
import { Logger } from '../utils/logger';
import { 
  UsageRecord, 
  UsageAnalytics, 
  User,
  FlowmatikError 
} from '../types';

export class UsageTrackingService {
  private db: DatabaseService;
  private cache: CacheService;
  private logger: Logger;
  private batchSize: number = 100;
  private flushInterval: number = 60000; // 1 minute
  private pendingRecords: Map<string, UsageRecord[]> = new Map();

  constructor(db: DatabaseService, cache: CacheService) {
    this.db = db;
    this.cache = cache;
    this.logger = new Logger('UsageTrackingService');

    // Start batch processing
    this.startBatchProcessor();
  }

  /**
   * Track AI request usage
   */
  async trackAIRequest(
    userId: string,
    data: {
      type: 'text_generation' | 'image_generation' | 'video_generation' | 'audio_generation';
      model: string;
      tokens?: number;
      cost: number;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      const record: UsageRecord = {
        id: this.generateId(),
        userId,
        type: data.type,
        model: data.model,
        tokens: data.tokens,
        cost: data.cost,
        metadata: data.metadata || {},
        timestamp: new Date()
      };

      // Add to pending batch
      if (!this.pendingRecords.has(userId)) {
        this.pendingRecords.set(userId, []);
      }
      this.pendingRecords.get(userId)!.push(record);

      // Update real-time counters in cache
      await this.updateRealtimeCounters(userId, data);

      // Check if user exceeds limits
      await this.checkUsageLimits(userId);

      this.logger.debug(`Usage tracked for user ${userId}: ${data.type} - $${data.cost}`);
    } catch (error) {
      this.logger.error('Failed to track usage:', error);
      throw new FlowmatikError('Failed to track usage', 'USAGE_TRACKING_ERROR');
    }
  }

  /**
   * Get user usage analytics
   */
  async getUserUsageAnalytics(
    userId: string,
    period: 'day' | 'week' | 'month' = 'day'
  ): Promise<UsageAnalytics> {
    try {
      const { startDate, endDate } = this.getPeriodDates(period);

      // Get usage records for the period
      const records = await this.db.query(
        `SELECT type, model, COUNT(*) as requests, SUM(tokens) as tokens, SUM(cost) as cost
         FROM usage_records 
         WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
         GROUP BY type, model
         ORDER BY cost DESC`,
        [userId, startDate, endDate]
      );

      // Get daily breakdown
      const dailyUsage = await this.db.query(
        `SELECT DATE(timestamp) as date, COUNT(*) as requests, SUM(cost) as cost
         FROM usage_records 
         WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
         GROUP BY DATE(timestamp)
         ORDER BY date`,
        [userId, startDate, endDate]
      );

      // Calculate totals
      const totals = records.reduce(
        (acc, record) => ({
          requests: acc.requests + record.requests,
          tokens: acc.tokens + (record.tokens || 0),
          cost: acc.cost + record.cost
        }),
        { requests: 0, tokens: 0, cost: 0 }
      );

      // Calculate breakdown by type
      const breakdown = {
        text: { requests: 0, tokens: 0, cost: 0 },
        image: { requests: 0, cost: 0 },
        video: { requests: 0, cost: 0 },
        audio: { requests: 0, cost: 0 }
      };

      records.forEach(record => {
        switch (record.type) {
          case 'text_generation':
            breakdown.text.requests += record.requests;
            breakdown.text.tokens += record.tokens || 0;
            breakdown.text.cost += record.cost;
            break;
          case 'image_generation':
            breakdown.image.requests += record.requests;
            breakdown.image.cost += record.cost;
            break;
          case 'video_generation':
            breakdown.video.requests += record.requests;
            breakdown.video.cost += record.cost;
            break;
          case 'audio_generation':
            breakdown.audio.requests += record.requests;
            breakdown.audio.cost += record.cost;
            break;
        }
      });

      // Get top models
      const topModels = records
        .map(record => ({
          model: record.model,
          usage: record.requests,
          cost: record.cost
        }))
        .slice(0, 10);

      return {
        period,
        totalRequests: totals.requests,
        totalTokens: totals.tokens,
        totalCost: totals.cost,
        breakdown,
        topModels,
        dailyUsage: dailyUsage.map(day => ({
          date: day.date,
          requests: day.requests,
          cost: day.cost
        }))
      };
    } catch (error) {
      this.logger.error('Failed to get usage analytics:', error);
      throw new FlowmatikError('Failed to get usage analytics', 'ANALYTICS_ERROR');
    }
  }

  /**
   * Get current usage for user
   */
  async getCurrentUsage(userId: string): Promise<{
    today: { requests: number; tokens: number; cost: number };
    thisMonth: { requests: number; tokens: number; cost: number };
    limits: { requests: number; tokens: number };
    remaining: { requests: number; tokens: number };
  }> {
    try {
      // Try to get from cache first
      const cached = await this.cache.get(`usage:current:${userId}`);
      if (cached) {
        return cached;
      }

      // Get from database
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const thisMonth = new Date();
      thisMonth.setDate(1);
      thisMonth.setHours(0, 0, 0, 0);

      const [todayUsage] = await this.db.query(
        `SELECT COUNT(*) as requests, SUM(tokens) as tokens, SUM(cost) as cost
         FROM usage_records 
         WHERE user_id = ? AND timestamp >= ?`,
        [userId, today]
      );

      const [monthUsage] = await this.db.query(
        `SELECT COUNT(*) as requests, SUM(tokens) as tokens, SUM(cost) as cost
         FROM usage_records 
         WHERE user_id = ? AND timestamp >= ?`,
        [userId, thisMonth]
      );

      // Get user's plan limits
      const limits = await this.getUserLimits(userId);

      const result = {
        today: {
          requests: todayUsage?.requests || 0,
          tokens: todayUsage?.tokens || 0,
          cost: todayUsage?.cost || 0
        },
        thisMonth: {
          requests: monthUsage?.requests || 0,
          tokens: monthUsage?.tokens || 0,
          cost: monthUsage?.cost || 0
        },
        limits,
        remaining: {
          requests: limits.requests === -1 ? -1 : Math.max(0, limits.requests - (todayUsage?.requests || 0)),
          tokens: limits.tokens === -1 ? -1 : Math.max(0, limits.tokens - (todayUsage?.tokens || 0))
        }
      };

      // Cache for 5 minutes
      await this.cache.set(`usage:current:${userId}`, result, 300);

      return result;
    } catch (error) {
      this.logger.error('Failed to get current usage:', error);
      throw new FlowmatikError('Failed to get current usage', 'USAGE_ERROR');
    }
  }

  /**
   * Check if user can make request
   */
  async canMakeRequest(
    userId: string,
    estimatedTokens: number = 1000
  ): Promise<{
    allowed: boolean;
    reason?: string;
    remainingRequests: number;
    remainingTokens: number;
  }> {
    try {
      const usage = await this.getCurrentUsage(userId);

      // Check request limit
      if (usage.limits.requests !== -1 && usage.today.requests >= usage.limits.requests) {
        return {
          allowed: false,
          reason: 'Daily request limit exceeded',
          remainingRequests: 0,
          remainingTokens: usage.remaining.tokens
        };
      }

      // Check token limit
      if (usage.limits.tokens !== -1 && (usage.today.tokens + estimatedTokens) > usage.limits.tokens) {
        return {
          allowed: false,
          reason: 'Daily token limit exceeded',
          remainingRequests: usage.remaining.requests,
          remainingTokens: usage.remaining.tokens
        };
      }

      return {
        allowed: true,
        remainingRequests: usage.remaining.requests,
        remainingTokens: usage.remaining.tokens
      };
    } catch (error) {
      this.logger.error('Failed to check request permission:', error);
      // Allow request on error to avoid blocking users
      return {
        allowed: true,
        remainingRequests: -1,
        remainingTokens: -1
      };
    }
  }

  /**
   * Get usage summary for billing
   */
  async getBillingSummary(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalCost: number;
    breakdown: Record<string, { requests: number; cost: number }>;
    overages: { requests: number; cost: number };
  }> {
    try {
      const records = await this.db.query(
        `SELECT type, model, COUNT(*) as requests, SUM(cost) as cost
         FROM usage_records 
         WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
         GROUP BY type, model`,
        [userId, startDate, endDate]
      );

      const totalCost = records.reduce((sum, record) => sum + record.cost, 0);

      const breakdown: Record<string, { requests: number; cost: number }> = {};
      records.forEach(record => {
        const key = `${record.type}_${record.model}`;
        breakdown[key] = {
          requests: record.requests,
          cost: record.cost
        };
      });

      // Calculate overages
      const limits = await this.getUserLimits(userId);
      const totalRequests = records.reduce((sum, record) => sum + record.requests, 0);
      
      let overages = { requests: 0, cost: 0 };
      if (limits.requests !== -1 && totalRequests > limits.requests) {
        overages.requests = totalRequests - limits.requests;
        overages.cost = overages.requests * 0.01; // $0.01 per overage request
      }

      return {
        totalCost,
        breakdown,
        overages
      };
    } catch (error) {
      this.logger.error('Failed to get billing summary:', error);
      throw new FlowmatikError('Failed to get billing summary', 'BILLING_ERROR');
    }
  }

  /**
   * Reset daily usage counters
   */
  async resetDailyUsage(): Promise<void> {
    try {
      // This would typically be called by a cron job at midnight
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Clear cache for all users
      const userIds = await this.db.query('SELECT DISTINCT user_id FROM usage_records');
      
      for (const { user_id } of userIds) {
        await this.cache.del(`usage:current:${user_id}`);
        await this.cache.del(`usage:realtime:${user_id}`);
      }

      this.logger.info('Daily usage counters reset');
    } catch (error) {
      this.logger.error('Failed to reset daily usage:', error);
    }
  }

  /**
   * Get system-wide usage statistics
   */
  async getSystemUsageStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalRequests: number;
    totalCost: number;
    averageCostPerUser: number;
    topUsers: Array<{ userId: string; requests: number; cost: number }>;
  }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [stats] = await this.db.query(
        `SELECT 
           COUNT(DISTINCT user_id) as active_users,
           COUNT(*) as total_requests,
           SUM(cost) as total_cost
         FROM usage_records 
         WHERE timestamp >= ?`,
        [today]
      );

      const [totalUsers] = await this.db.query(
        'SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL'
      );

      const topUsers = await this.db.query(
        `SELECT user_id, COUNT(*) as requests, SUM(cost) as cost
         FROM usage_records 
         WHERE timestamp >= ?
         GROUP BY user_id
         ORDER BY cost DESC
         LIMIT 10`,
        [today]
      );

      const averageCostPerUser = stats.active_users > 0 
        ? stats.total_cost / stats.active_users 
        : 0;

      return {
        totalUsers: totalUsers.count,
        activeUsers: stats.active_users || 0,
        totalRequests: stats.total_requests || 0,
        totalCost: stats.total_cost || 0,
        averageCostPerUser,
        topUsers: topUsers.map(user => ({
          userId: user.user_id,
          requests: user.requests,
          cost: user.cost
        }))
      };
    } catch (error) {
      this.logger.error('Failed to get system usage stats:', error);
      throw new FlowmatikError('Failed to get system stats', 'STATS_ERROR');
    }
  }

  // Private helper methods

  private async updateRealtimeCounters(
    userId: string,
    data: {
      type: string;
      tokens?: number;
      cost: number;
    }
  ): Promise<void> {
    const key = `usage:realtime:${userId}`;
    const current = await this.cache.get(key) || {
      requests: 0,
      tokens: 0,
      cost: 0
    };

    current.requests += 1;
    current.tokens += data.tokens || 0;
    current.cost += data.cost;

    // Cache for 24 hours
    await this.cache.set(key, current, 86400);
  }

  private async checkUsageLimits(userId: string): Promise<void> {
    const usage = await this.getCurrentUsage(userId);
    
    // Send warnings at 80% and 95% of limits
    if (usage.limits.requests !== -1) {
      const usagePercent = (usage.today.requests / usage.limits.requests) * 100;
      
      if (usagePercent >= 95) {
        await this.sendUsageAlert(userId, 'critical', usagePercent);
      } else if (usagePercent >= 80) {
        await this.sendUsageAlert(userId, 'warning', usagePercent);
      }
    }
  }

  private async sendUsageAlert(
    userId: string,
    level: 'warning' | 'critical',
    usagePercent: number
  ): Promise<void> {
    // Check if we've already sent this alert today
    const alertKey = `usage:alert:${userId}:${level}:${new Date().toDateString()}`;
    const alreadySent = await this.cache.exists(alertKey);
    
    if (!alreadySent) {
      // TODO: Send email or push notification
      this.logger.info(`Usage alert sent to user ${userId}: ${level} - ${usagePercent}%`);
      
      // Mark as sent for today
      await this.cache.set(alertKey, true, 86400);
    }
  }

  private async getUserLimits(userId: string): Promise<{ requests: number; tokens: number }> {
    const [user] = await this.db.query(
      `SELECT s.plan 
       FROM users u
       LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
       WHERE u.id = ?`,
      [userId]
    );

    const plan = user?.plan || 'free';
    
    const limits = {
      free: { requests: 100, tokens: 50000 },
      starter: { requests: 1000, tokens: 500000 },
      pro: { requests: 10000, tokens: 5000000 },
      business: { requests: -1, tokens: -1 }
    };

    return limits[plan as keyof typeof limits] || limits.free;
  }

  private startBatchProcessor(): void {
    setInterval(async () => {
      await this.flushPendingRecords();
    }, this.flushInterval);
  }

  private async flushPendingRecords(): Promise<void> {
    if (this.pendingRecords.size === 0) return;

    try {
      const allRecords: UsageRecord[] = [];
      
      // Collect all pending records
      for (const [userId, records] of this.pendingRecords.entries()) {
        allRecords.push(...records);
      }

      if (allRecords.length === 0) return;

      // Batch insert to database
      const values = allRecords.map(record => [
        record.id,
        record.userId,
        record.type,
        record.model,
        record.tokens,
        record.cost,
        JSON.stringify(record.metadata),
        record.timestamp
      ]);

      await this.db.query(
        `INSERT INTO usage_records 
         (id, user_id, type, model, tokens, cost, metadata, timestamp)
         VALUES ${values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        values.flat()
      );

      // Clear pending records
      this.pendingRecords.clear();

      this.logger.debug(`Flushed ${allRecords.length} usage records to database`);
    } catch (error) {
      this.logger.error('Failed to flush usage records:', error);
    }
  }

  private getPeriodDates(period: 'day' | 'week' | 'month'): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'day':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'month':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }

    return { startDate, endDate };
  }

  private generateId(): string {
    return `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

