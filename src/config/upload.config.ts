import { Environment, integer, text } from './environment';

export function uploadConfig(env: Environment) {
  return {
    directory: text(env, 'UPLOAD_DIRECTORY', 'uploads/products'),
    maxBytes: integer(env, 'UPLOAD_MAX_BYTES', '5242880', 5242880),
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  };
}
