import { ConfigService } from '@nestjs/config';
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Configuration } from '../../config/configuration';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';
import { ImageStorage } from './image-storage';

describe('canonical image storage/content validation', () => {
  let directory: string;
  let storage: ImageStorage;
  const context = { productId: randomUUID(), correlationId: randomUUID() };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nest-image-unit-'));
    storage = new ImageStorage(
      new ConfigService<Configuration, true>({
        upload: {
          directory,
          maxBytes: 5242880,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        },
      }),
      new SafeJsonLogger(() => undefined),
    );
  });
  afterAll(async () => {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !directory.includes('nest-image-unit-')
    )
      throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true });
  });
  function file(
    buffer: Buffer,
    mimetype = 'image/png',
    originalname = 'image.png',
  ) {
    return { buffer, mimetype, originalname } as Express.Multer.File;
  }
  it.each(['png', 'jpeg', 'webp'] as const)(
    'fully decodes/re-encodes %s and stores only generated relative names',
    async (format) => {
      const buffer = await sharp({
        create: { width: 3, height: 2, channels: 3, background: '#aabbcc' },
      })
        .toFormat(format)
        .toBuffer();
      const image = await storage.encode(file(buffer, 'image/' + format));
      const reference = await storage.write(image, context);
      expect(reference).toMatch(/^[0-9a-f-]{36}\.(png|jpeg|webp)$/);
      const read = await storage.read(reference);
      expect(await sharp(read.buffer).metadata()).toMatchObject({
        width: 3,
        height: 2,
        format,
      });
      expect(read.mime).toBe('image/' + format);
      await storage.remove(reference);
      await storage.remove(reference);
    },
  );
  it('rejects spoofed MIME, truncated headers, unsupported content, unsafe names and oversized bytes', async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    for (const input of [
      file(png, 'image/jpeg'),
      file(png.subarray(0, 16)),
      file(Buffer.from('<svg></svg>')),
      file(Buffer.alloc(0)),
      file(png, 'image/png', '../escape.png'),
      file(png, 'image/png', 'C:\\host.png'),
    ])
      await expect(storage.encode(input)).rejects.toMatchObject({
        code: 'UPLOAD_INVALID_TYPE',
      });
    await expect(storage.encode(undefined)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      storage.encode(file(Buffer.alloc(5242881))),
    ).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
  });
  it.each([
    '../secret.png',
    '/etc/passwd',
    'C:\\outside.png',
    'products/../secret.png',
    'x%2fsecret.png',
    'ordinary.png',
  ])('blocks non-generated/traversal reference %s', async (reference) => {
    await expect(storage.read(reference)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(storage.remove(reference)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('rejects directory junction/symlink references and never deletes their target', async () => {
    const target = join(directory, 'outside');
    await mkdir(target);
    await writeFile(join(target, 'secret'), 'retained');
    const link = join(directory, randomUUID() + '.png');
    await symlink(target, link, 'junction');
    await expect(
      storage.read(link.split(/[\\/]/).at(-1)!),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      storage.remove(link.split(/[\\/]/).at(-1)!),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await readdir(target)).toEqual(['secret']);
  });
  it('missing generated file returns404 and filesystem write failure creates no reference', async () => {
    await expect(storage.read(randomUUID() + '.png')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, 'file');
    const invalid = new ImageStorage(
      new ConfigService<Configuration, true>({
        upload: {
          directory: blocked,
          maxBytes: 5242880,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        },
      }),
      new SafeJsonLogger(() => undefined),
    );
    await expect(
      invalid.write({ buffer: Buffer.from('unused'), format: 'png' }, context),
    ).rejects.toThrow();
  });
});
