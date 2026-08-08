import { mock } from "bun:test";
import nodeWasm from "../rust/wasm/pkg-node/opencut_wasm.js";

// wasm-pack's `bundler` target is used by Next.js. Bun's test runner does not
// implement that `.wasm` ESM loading convention, so tests execute the exact
// same Rust binary through wasm-pack's Node loader.
mock.module("opencut-wasm", () => nodeWasm);
