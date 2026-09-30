import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

const DISABLED_API_LIMIT = new Set([
  '0',
  'off',
  'none',
  'unlimited',
  'false',
  'disabled',
]);

// hourly cap for POST /public/v1/posts, counted per organization
// null disables Postiz's own throttle. Unset API_LIMIT stays at 90
// 0, off, none, unlimited, false, and disabled turn the cap off
// a non-numeric value keeps the default so a typo does not drop the cap
export function publicApiPostThrottleLimit(): number | null {
  const raw = process.env.API_LIMIT;
  if (raw == null || raw.trim() === '') {
    return 90;
  }

  const normalized = raw.trim().toLowerCase();
  if (DISABLED_API_LIMIT.has(normalized)) {
    return null;
  }

  const limit = Number(normalized);
  if (!Number.isFinite(limit)) {
    return 90;
  }

  const whole = Math.floor(limit);
  if (whole <= 0) {
    return null;
  }

  return whole;
}

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    if (publicApiPostThrottleLimit() === null) {
      return true;
    }

    const { url, method } = context.switchToHttp().getRequest<Request>();
    if (method === 'POST' && url.includes('/public/v1/posts')) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    return (
      req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}

// route-level guard for public endpoints, keyed by the client address the
// proxy forwards rather than the org the global guard expects
@Injectable()
export class ThrottlerRealIpGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '');
    return forwarded.split(',')[0].trim() || req.ip;
  }
}
