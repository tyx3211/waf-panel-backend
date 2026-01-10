import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Performance');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const message = `${method} ${url} - ${duration}ms`;

        // 慢请求警告（超过 1 秒）
        if (duration > 1000) {
          this.logger.warn(`🐌 SLOW: ${message}`);
        } else if (duration > 500) {
          this.logger.log(`⚠️  ${message}`);
        } else {
          // this.logger.debug(`✅ ${message}`);
        }
      }),
    );
  }
}
