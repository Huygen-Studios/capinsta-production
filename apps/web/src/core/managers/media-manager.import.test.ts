import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { MediaAsset } from "@/media/types";

const saveMediaAssetMock = mock(async () => undefined);
const isQuotaExceededErrorMock = mock(() => false);
const getMediaStorageFailureMessageMock = mock(
	() => "Media could not be saved in this browser.",
);
const toastErrorMock = mock(() => undefined);
const toastWarningMock = mock(() => undefined);

mock.module("@/services/storage/service", () => ({
	storageService: {
		saveMediaAsset: saveMediaAssetMock,
		isQuotaExceededError: isQuotaExceededErrorMock,
		getMediaStorageFailureMessage: getMediaStorageFailureMessageMock,
	},
}));

mock.module("sonner", () => ({
	toast: {
		error: toastErrorMock,
		warning: toastWarningMock,
	},
}));

mock.module("@/commands", () => ({
	BatchCommand: class BatchCommand {
		constructor(public readonly commands: unknown[]) {}
	},
	RemoveMediaAssetCommand: class RemoveMediaAssetCommand {
		constructor(public readonly input: unknown) {}
	},
}));

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => 120_000,
	ZERO_MEDIA_TIME: 0,
	ONE_MEDIA_TICK: 1,
	mediaTime: ({ ticks }: { ticks: number }) => ticks,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * 120_000),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / 120_000,
	addMediaTime: ({ a, b }: { a: number; b: number }) => a + b,
	subMediaTime: ({ a, b }: { a: number; b: number }) => a - b,
	maxMediaTime: ({ a, b }: { a: number; b: number }) => Math.max(a, b),
	minMediaTime: ({ a, b }: { a: number; b: number }) => Math.min(a, b),
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	lastFrameMediaTime: ({ duration }: { duration: number }) => duration,
	formatTimecode: () => "00:00:00:00",
	parseTimecode: () => undefined,
	roundToFrame: ({ time }: { time: number }) => time,
	roundFrameTime: ({ time }: { time: number }) => time,
	snappedSeekTime: ({ time }: { time: number }) => time,
}));

const { MediaManager } = await import("./media-manager");

function makeAsset(): Omit<MediaAsset, "id"> {
	const file = new File(["video"], "video.webm", { type: "video/webm" });
	return {
		name: file.name,
		type: "video",
		mimeType: file.type,
		file,
		url: "blob:video",
		duration: 1,
	};
}

function makeEditor() {
	return {
		project: {
			ratchetFpsForImportedMedia: mock(() => null),
		},
	};
}

describe("MediaManager local import", () => {
	beforeEach(() => {
		saveMediaAssetMock.mockClear();
		isQuotaExceededErrorMock.mockClear();
		getMediaStorageFailureMessageMock.mockClear();
		toastErrorMock.mockClear();
		toastWarningMock.mockClear();
	});

	test("successful local import saves media without backend upload", async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- MediaManager only uses the small editor surface provided by this test double.
		const manager = new MediaManager(makeEditor() as never);

		const imported = await manager.addMediaAsset({
			projectId: "project-1",
			asset: makeAsset(),
		});

		expect(imported?.syncStatus).toBe("local");
		expect(imported?.serverAssetId).toBeUndefined();
		expect(saveMediaAssetMock).toHaveBeenCalledTimes(1);
		expect(saveMediaAssetMock.mock.calls[0]?.[0].mediaAsset.serverAssetId).toBeUndefined();
		expect(toastWarningMock).not.toHaveBeenCalled();
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	test("local storage failure shows a storage error and does not keep the asset", async () => {
		saveMediaAssetMock.mockImplementationOnce(async () => {
			throw new DOMException("Blocked", "SecurityError");
		});
		getMediaStorageFailureMessageMock.mockReturnValueOnce(
			"Your browser blocked local storage for this site. Enable site storage and try again.",
		);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- MediaManager only uses the small editor surface provided by this test double.
		const manager = new MediaManager(makeEditor() as never);

		const imported = await manager.addMediaAsset({
			projectId: "project-1",
			asset: makeAsset(),
		});

		expect(imported).toBeNull();
		expect(toastErrorMock).toHaveBeenCalledWith("Could not store media", {
			description:
				"Your browser blocked local storage for this site. Enable site storage and try again.",
		});
		expect(manager.getAssets()).toHaveLength(0);
	});
});
