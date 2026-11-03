import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { Configuration } from '../../config/configuration';
import { ApiError } from '../../common/http/api-error';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';

export interface ImageContext {
  productId: string;
  correlationId: string;
}
const referencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|png|webp)$/;
const mimeTypes = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

@Injectable()
export class ImageStorage {
  constructor(
    private readonly config: ConfigService<Configuration, true>,
    private readonly logger: SafeJsonLogger,
  ) {}
  async encode(file: Express.Multer.File | undefined) {
    if (!file) throw new ApiError('VALIDATION_FAILED');
    const cfg = this.config.get('upload', { infer: true });
    if (file.buffer.length > cfg.maxBytes)
      throw new ApiError('UPLOAD_TOO_LARGE');
    if (!file.buffer.length || /[\\/:]|\p{Cc}/u.test(file.originalname))
      throw new ApiError('UPLOAD_INVALID_TYPE');
    const signature = file.buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : file.buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        ? 'jpeg'
        : file.buffer.toString('ascii', 0, 4) === 'RIFF' &&
            file.buffer.toString('ascii', 8, 12) === 'WEBP'
          ? 'webp'
          : undefined;
    if (!signature) throw new ApiError('UPLOAD_INVALID_TYPE');
    try {
      const image = sharp(file.buffer, {
        failOn: 'warning',
        limitInputPixels: 16000000,
        animated: true,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== signature ||
        !['jpeg', 'png', 'webp'].includes(metadata.format) ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error();
      const format = metadata.format;
      if (file.mimetype !== mimeTypes[format]) throw new Error();
      const buffer = await image.toFormat(format).toBuffer(); // Full decode + fresh encoding; metadata/trailing payload stripped.
      if (buffer.length > cfg.maxBytes) throw new ApiError('UPLOAD_TOO_LARGE');
      return { buffer, format };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UPLOAD_INVALID_TYPE');
    }
  }

  private async path(reference: string) {
    if (!referencePattern.test(reference)) throw new ApiError('NOT_FOUND');
    const directory = resolve(
      this.config.get('upload', { infer: true }).directory,
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const root = await realpath(directory);
    const target = resolve(root, reference);
    if (dirname(target) !== root) throw new ApiError('NOT_FOUND');
    return { root, target };
  }

  async write(
    image: Awaited<ReturnType<ImageStorage['encode']>>,
    context: ImageContext,
  ): Promise<string> {
    const reference = `${randomUUID()}.${image.format}`;
    const { target } = await this.path(reference);
    const handle = await open(target, 'wx', 0o600);
    try {
      await handle.writeFile(image.buffer);
      await handle.close();
      return reference;
    } catch (error) {
      await handle.close().catch(() => undefined);
      try {
        await this.remove(reference);
      } catch {
        this.logger.imageCleanupFailed(
          context.productId,
          context.correlationId,
          'partial',
        );
      }
      throw error;
    }
  }

  async read(reference: string): Promise<{ buffer: Buffer; mime: string }> {
    try {
      const { root, target } = await this.path(reference);
      const stat = await lstat(target);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        dirname(await realpath(target)) !== root
      )
        throw new ApiError('NOT_FOUND');
      const handle = await open(
        target,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.size > this.config.get('upload', { infer: true }).maxBytes
        )
          throw new ApiError('NOT_FOUND');
        const format = reference.split('.').at(-1) as keyof typeof mimeTypes;
        return { buffer: await handle.readFile(), mime: mimeTypes[format] };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error as NodeJS.ErrnoException).code === 'ELOOP'
      )
        throw new ApiError('NOT_FOUND');
      throw error;
    }
  }

  async remove(reference: string): Promise<void> {
    try {
      const { root, target } = await this.path(reference);
      const stat = await lstat(target);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        dirname(await realpath(target)) !== root
      )
        throw new ApiError('NOT_FOUND');
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
