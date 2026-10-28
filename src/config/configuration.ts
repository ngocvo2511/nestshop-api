import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { Environment } from './environment';
import { expiryConfig } from './expiry.config';
import { jwtConfig } from './jwt.config';
import { uploadConfig } from './upload.config';
import { vnpayConfig } from './vnpay.config';

export function validateEnvironment(env: Environment) {
  return {
    app: appConfig(env),
    db: databaseConfig(env),
    jwt: jwtConfig(env),
    upload: uploadConfig(env),
    expiry: expiryConfig(env),
    vnpay: vnpayConfig(env),
  };
}

export type Configuration = ReturnType<typeof validateEnvironment>;
