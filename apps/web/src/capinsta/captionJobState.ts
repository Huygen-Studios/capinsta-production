import type { CapinstaJobStatusHistoryEntry } from "./jobPolling";

export type CaptionJobStatus =
	| "idle"
	| "preparing"
	| "extracting_audio"
	| "transcribing"
	| "generating_captions"
	| "importing_captions"
	| "done"
	| "error";

export interface CaptionJobState {
	status: CaptionJobStatus;
	progressPercent: number | null;
	statusMessage: string;
	errorMessage: string | null;
	activeJobId: string | null;
	statusHistory: CapinstaJobStatusHistoryEntry[];
	debugWarning: string | null;
}

export type CaptionJobAction =
	| {
			type: "start";
			status: Exclude<CaptionJobStatus, "idle" | "done" | "error">;
			message: string;
	  }
	| {
			type: "progress";
			status?: Exclude<CaptionJobStatus, "idle" | "done" | "error">;
			message: string;
			progressPercent?: number | null;
			activeJobId?: string | null;
	  }
	| {
			type: "status_history";
			history: readonly CapinstaJobStatusHistoryEntry[];
			debugWarning?: string | null;
	  }
	| { type: "done"; message?: string }
	| { type: "error"; message: string }
	| { type: "reset" };

export const IDLE_CAPTION_JOB_STATE: CaptionJobState = {
	status: "idle",
	progressPercent: null,
	statusMessage: "",
	errorMessage: null,
	activeJobId: null,
	statusHistory: [],
	debugWarning: null,
};

export function isCaptionJobRunning(status: CaptionJobStatus): boolean {
	return !["idle", "done", "error"].includes(status);
}

export function captionJobButtonLabel(state: CaptionJobState): string {
	switch (state.status) {
		case "idle":
		case "done":
			return "Generate AI Captions";
		case "preparing":
			return "Preparing media...";
		case "extracting_audio":
			return "Extracting audio...";
		case "transcribing":
			return "Transcribing...";
		case "generating_captions":
			return "Generating captions...";
		case "importing_captions":
			return "Importing captions...";
		case "error":
			return "Retry Generate AI Captions";
	}
}

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
export function captionJobReducer(
	state: CaptionJobState,
	action: CaptionJobAction,
): CaptionJobState {
	switch (action.type) {
		case "start":
			return {
				status: action.status,
				progressPercent: null,
				statusMessage: action.message,
				errorMessage: null,
				activeJobId: null,
				statusHistory: [],
				debugWarning: null,
			};
		case "progress":
			return {
				...state,
				status: action.status ?? state.status,
				statusMessage: action.message,
				progressPercent:
					action.progressPercent === undefined
						? state.progressPercent
						: action.progressPercent,
				activeJobId:
					action.activeJobId === undefined
						? state.activeJobId
						: action.activeJobId,
			};
		case "status_history":
			return {
				...state,
				statusHistory: [...action.history],
				debugWarning:
					action.debugWarning === undefined
						? state.debugWarning
						: action.debugWarning,
			};
		case "done":
			return {
				...state,
				status: "done",
				progressPercent: 100,
				statusMessage: action.message ?? "Done",
				errorMessage: null,
				activeJobId: null,
				debugWarning: null,
			};
		case "error":
			return {
				...state,
				status: "error",
				statusMessage: "",
				errorMessage: action.message,
				activeJobId: null,
			};
		case "reset":
			return IDLE_CAPTION_JOB_STATE;
	}
}
/* eslint-enable opencut/prefer-object-params */
