import { resolveFeatureFlags } from "./featureFlags";

import type { UnobravoAuthMode, UnobravoFeatureFlags } from "../types";

const DEFAULT_AUTH_TIMEOUT_MS = 10_000;

const AUTH_MODES: readonly UnobravoAuthMode[] = ["disabled", "mock", "parent"];

export type UnobravoConfig = {
  mode: UnobravoAuthMode;
  /** Origins allowed to provide the session. Empty when not configured. */
  parentOrigins: readonly string[];
  authTimeoutMs: number;
  flags: UnobravoFeatureFlags;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  return typeof value === "boolean" ? String(value) : undefined;
};

const parseAuthMode = (value: unknown): UnobravoAuthMode => {
  const normalized = asString(value)?.trim().toLowerCase();

  return AUTH_MODES.find((mode) => mode === normalized) ?? "disabled";
};

const parseOrigins = (value: unknown): readonly string[] =>
  (asString(value) ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");

const parseTimeout = (value: unknown): number => {
  const parsed = Number(asString(value));

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_AUTH_TIMEOUT_MS;
};

export type ReadConfigOptions = {
  /** Usually `import.meta.env`. */
  env?: Record<string, unknown>;
  /** Usually `window.location.search`. */
  search?: string;
};

/**
 * Reads the layer's configuration. Anything missing or malformed degrades to
 * "layer off", so a build that doesn't set these vars is upstream Excalidraw.
 */
export const readUnobravoConfig = ({
  env = {},
  search = "",
}: ReadConfigOptions = {}): UnobravoConfig => {
  const allowOverrides =
    env.DEV === true ||
    asString(env.DEV) === "true" ||
    asString(env.VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES) === "true";

  return {
    mode: parseAuthMode(env.VITE_APP_UNOBRAVO_AUTH_MODE),
    parentOrigins: parseOrigins(env.VITE_APP_UNOBRAVO_PARENT_ORIGINS),
    authTimeoutMs: parseTimeout(env.VITE_APP_UNOBRAVO_AUTH_TIMEOUT_MS),
    flags: resolveFeatureFlags({ env, search, allowOverrides }),
  };
};

/**
 * Reads the configuration from the actual build/runtime environment.
 *
 * `import.meta.env` is a typed interface without an index signature, so it is
 * widened here — in this one place — to keep `readUnobravoConfig` injectable
 * (and therefore unit-testable).
 */
export const readUnobravoConfigFromEnv = (search: string): UnobravoConfig =>
  readUnobravoConfig({
    env: import.meta.env as unknown as Record<string, unknown>,
    search,
  });
