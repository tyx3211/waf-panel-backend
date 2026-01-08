import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const res = ctx.getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => {
        // 对文件/流/Buffer 不包裹
        if (data instanceof Buffer) return data;
        if (
          res?.getHeader &&
          res.getHeader('Content-Type') === 'application/pdf'
        ) {
          return data;
        }
        // 已经是 envelope 的直接返回
        if (
          data &&
          typeof data === 'object' &&
          'code' in data &&
          'data' in data
        ) {
          return data as Envelope<unknown>;
        }
        const envelope: Envelope<unknown> = {
          code: 0,
          message: 'ok',
          data: data === undefined ? null : data,
        };
        return envelope;
      }),
    );
  }
}
