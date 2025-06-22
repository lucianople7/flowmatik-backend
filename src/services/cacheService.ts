import { createClient, RedisClientType } from 'redis';
import { Logger } from '../utils/logger';

export class CacheService {
  private client: RedisClientType;
  private logger: Logger;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.logger = new Logger('CacheService');
  }

  async connect(): Promise<void> {
    try {
      this.client = createClient({
        url: this.config.url || `redis://${this.config.host}:${this.config.port}`,
        password: this.config.password
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis client error:', err);
      });

      this.client.on('connect', () => {
        this.logger.info('Redis client connected');
      });

      await this.client.connect();
      this.logger.info('Cache service connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to cache:', error);
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error('Cache get failed:', { key, error });
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.error('Cache set failed:', { key, error });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error('Cache delete failed:', { key, error });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Cache exists check failed:', { key, error });
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.info('Cache connection closed');
    }
  }
}

