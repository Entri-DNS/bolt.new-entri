import { env } from 'node:process';

export function getEntriAppSecret(cloudflareEnv: Env) {
  /**
   * The `cloudflareEnv` is only used when deployed or when previewing locally.
   * In development the environment variables are available through `env`.
   */
  return env.APPLICATION_SECRET || cloudflareEnv.APPLICATION_SECRET;
}
