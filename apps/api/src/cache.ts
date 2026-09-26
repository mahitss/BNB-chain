/**
 * TTL cache for RWA data.
 *
 * Redis is used when REDIS_URL is configured (Redis exists in the Phase 1
 * compose stack); otherwise an in-process TTL map is used. Values are JSON
 * blobs; TTLs come from @olyr/config and are configurable per data class
 * (metadata vs prices). A failing Redis connection degrades to the
 * in-process cache instead of taking the API down.
 */
import type { Logger } from "@olyr/binance";

export interface TtlCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  close(): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryTtlCache implements TtlCache {
  private readonly store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

export async function createTtlCache(
  redisUrl: string | undefined,
  logger: Logger,
): Promise<TtlCache> {
  if (!redisUrl) {
    return new MemoryTtlCache();
  }
  try {
    const { default: Redis } = await import("ioredis");
    const RedisClient = Redis as unknown as new (
      url: string,
      options: Record<string, unknown>,
    ) => import("ioredis").Redis;
    const redis = new RedisClient(redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 500, 2000)),
    });
    redis.on("error", (error: Error) => {
      logger.warn("rwa.cache.redis_error", { message: error.message });
    });
    await redis.ping();
    logger.info("rwa.cache.redis_connected", {});
    return {
      async get<T>(key: string): Promise<T | null> {
        const raw = await redis.get(key);
        return raw === null ? null : (JSON.parse(raw) as T);
      },
      async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
      },
      async close(): Promise<void> {
        redis.disconnect();
      },
    };
  } catch (error) {
    logger.warn("rwa.cache.redis_unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return new MemoryTtlCache();
  }
}
