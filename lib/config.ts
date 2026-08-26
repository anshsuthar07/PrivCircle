export class ConfigurationError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`);
    this.name = "ConfigurationError";
  }
}

export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new ConfigurationError(name);
  }
  return value;
}

export function getAppOrigin(request?: Request) {
  if (process.env.APP_ORIGIN) {
    return process.env.APP_ORIGIN.replace(/\/$/, "");
  }

  if (request) {
    return new URL(request.url).origin;
  }

  return "http://localhost:3000";
}

export const isProduction = process.env.NODE_ENV === "production";
