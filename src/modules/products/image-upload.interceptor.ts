import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import multer from 'multer';
import { Configuration } from '../../config/configuration';
import { ApiError } from '../../common/http/api-error';

@Injectable()
export class ImageUploadInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService<Configuration, true>) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.is('multipart/form-data'))
      throw new ApiError('VALIDATION_FAILED');
    const upload = multer({
      storage: multer.memoryStorage(),
      preservePath: true,
      limits: {
        fileSize: this.config.get('upload', { infer: true }).maxBytes + 1,
        files: 1,
        fields: 0,
        parts: 2, // Busboy signals partsLimit upon reaching the limit; fields/files still enforce exactly one file.
        headerPairs: 32,
        fieldNameSize: 64,
      },
    }).single('file');
    await new Promise<void>((resolve, reject) =>
      upload(
        request,
        context.switchToHttp().getResponse<Response>(),
        (error: unknown) => {
          if (!error) resolve();
          else
            reject(
              new ApiError(
                error instanceof multer.MulterError &&
                  error.code === 'LIMIT_FILE_SIZE'
                  ? 'UPLOAD_TOO_LARGE'
                  : 'VALIDATION_FAILED',
              ),
            );
        },
      ),
    );
    return next.handle();
  }
}
