import { describe, expect, test } from "bun:test"
import {
  getCapinstaApiBaseUrl,
  getCapinstaJobTimeoutMs,
  isCapinstaSampleImportEnabled,
} from "./featureFlags"

function restoreEnv({
  name,
  value,
}: {
  name: "NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT"
  value: string | undefined
}) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

describe("Capinsta feature flags", () => {
  test("keeps sample import disabled by default", () => {
    const previous = process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT
    delete process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT

    expect(isCapinstaSampleImportEnabled()).toBe(false)

    restoreEnv({
      name: "NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT",
      value: previous,
    })
  })

  test("enables sample import from the direct Next public flag", () => {
    const previous = process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT
    process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT = "true"

    expect(isCapinstaSampleImportEnabled()).toBe(true)

    restoreEnv({
      name: "NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT",
      value: previous,
    })
  })

  test("reads and normalizes the Capinsta backend URL", () => {
    const previous = process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL
    process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL = "http://127.0.0.1:8000/"

    expect(getCapinstaApiBaseUrl()).toBe("http://127.0.0.1:8000")

    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL
      return
    }
    process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL = previous
  })

  test("uses a configurable caption job timeout", () => {
    const previous = process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS
    process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS = "1500"

    expect(getCapinstaJobTimeoutMs()).toBe(1500)

    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS
      return
    }
    process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS = previous
  })
})
