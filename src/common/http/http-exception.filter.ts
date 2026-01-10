import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { join } from 'path';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      // SPA Fallback: Redirect 404s on non-API routes to index.html
      if (status === HttpStatus.NOT_FOUND && !request.path.startsWith('/api')) {
        response.sendFile(join(process.cwd(), 'client', 'index.html'));
        return;
      }

      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string })?.message ??
            exception.message ??
            'error');
      response.status(status).json({
        code: status,
        message,
        data: null,
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        exception instanceof Error
          ? exception.message
          : 'internal server error',
      data: null,
    });
  }
}
