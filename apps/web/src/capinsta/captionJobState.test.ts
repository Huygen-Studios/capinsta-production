import { describe, expect, test } from "bun:test";
import {
	captionJobReducer,
	IDLE_CAPTION_JOB_STATE,
	isCaptionJobRunning,
} from "./captionJobState";

describe("caption job state", () => {
	test("resets after an error so the UI can retry", () => {
		const running = captionJobReducer(IDLE_CAPTION_JOB_STATE, {
			type: "start",
			status: "transcribing",
			message: "Transcribing speech...",
		});
		expect(isCaptionJobRunning(running.status)).toBe(true);

		const failed = captionJobReducer(running, {
			type: "error",
			message: "Backend failed",
		});

		expect(isCaptionJobRunning(failed.status)).toBe(false);
		expect(failed.errorMessage).toBe("Backend failed");
	});
});
