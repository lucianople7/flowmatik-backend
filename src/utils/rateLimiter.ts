export class RateLimiter {
  private cache: Map<string, { count: number; resetTime: number }> = new Map();

  async checkLimit(
    key: string, 
    type: string, 
    options: { max: number; window: number }
  ): Promise<boolean> {
    const now = Date.now();
    const cacheKey = `${type}:${key}`;
    const entry = this.cache.get(cacheKey);

    if (!entry || now > entry.resetTime) {
      // Reset or create new entry
      this.cache.set(cacheKey, {
        count: 1,
        resetTime: now + options.window
      });
      return true;
    }

    if (entry.count >= options.max) {
      return false;
    }

    entry.count++;
    return true;
  }

  // Clean up expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.resetTime) {
        this.cache.delete(key);
      }
    }
  }
}

