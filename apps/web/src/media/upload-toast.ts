import { toast } from "sonner";

export interface MediaUploadToastResult {
	uploadedCount: number;
	localImportCount?: number;
	failedSyncCount?: number;
	assetNames?: string[];
}

function getAssetLabel({ count }: { count: number }): string {
	return count === 1 ? "media asset" : "media assets";
}

function waitForNextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

export async function showMediaUploadToast<T extends MediaUploadToastResult>({
	filesCount,
	promise,
}: {
	filesCount: number;
	promise: Promise<T> | (() => Promise<T>);
}) {
	const run = typeof promise === "function" ? promise : () => promise;
	const toastPromise = toast.promise(async () => {
		await waitForNextPaint();
		return run();
	}, {
		loading: `Uploading ${getAssetLabel({ count: filesCount })}...`,
		success: ({ uploadedCount, localImportCount = uploadedCount, failedSyncCount = 0, assetNames }) => {
			if (uploadedCount === 0 && failedSyncCount > 0) {
				return localImportCount === 1
					? "Imported locally; backend sync failed"
					: `${localImportCount} media assets imported locally; backend sync failed`;
			}
			if (failedSyncCount > 0) {
				return `${uploadedCount} synced, ${failedSyncCount} imported locally`;
			}
			if (uploadedCount === 1) {
				const assetName = assetNames?.[0];
				return assetName
					? `${assetName} has been uploaded`
					: "1 media asset has been uploaded";
			}

			if (uploadedCount > 1) {
				return `${uploadedCount} media assets have been uploaded`;
			}

			return "No media assets were uploaded";
		},
		error: `Failed to upload ${getAssetLabel({ count: filesCount })}`,
	});

	return toastPromise.unwrap();
}
