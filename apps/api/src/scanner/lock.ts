/**
 * Distributed lock over Redis (SET NX PX lease) used to prevent overlapping
 * scans across multiple API instances. Returns null when Redis is not
 * configured — callers then rely on the in-process lock only.
 */
import type { Logger } from "@olyr/binance";

export interface DistributedLock {
  acquireLease: (key: string, ttlMs: number) => Promise<boolean>;
  releaseLease: (key: string) => Promise<void>;
}

export async function createDistributedLock(
  redisUrl: string | undefined,
  logger: Logger,
): Promise<DistributedLock | null> {
  if (!redisUrl) {
    return null;
  }
  try {
    const { default: Redis } = await import("ioredis");
    const RedisClient = Redis as unknown as new (
      url: string,
      options: Record<string, unknown>,
    ) => import("ioredis").Redis;
    const redis = new RedisClient(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    redis.on("error", (error: Error) => {
      logger.warn("scan.lock.redis_error", { message: error.message });
    });
    return {
      async acquireLease(key: string, ttlMs: number): Promise<boolean> {
        try {
          const result = await redis.set(key, "1", "PX", ttlMs, "NX");
          return result === "OK";
        } catch {
          // If Redis fails, fail closed for the distributed lease but let the
          // local in-process lock still protect this instance.
          return false;
        }
      },
      async releaseLease(key: string): Promise<void> {
        try {
          await redis.del(key);
        } catch {
          // Lease expires on its own via TTL.
        }
      },
    };
  } catch (error) {
    logger.warn("scan.lock.redis_unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
