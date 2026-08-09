import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = resolve(APP_DIR, "../..");
export const BUNDLE_DIR = resolve(APP_DIR, ".cache/bundle");
export const PUBLIC_DIR = resolve(APP_DIR, ".cache/public");
export const GENERATED_DIR = resolve(APP_DIR, "fixtures/generated");
