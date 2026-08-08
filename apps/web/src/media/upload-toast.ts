import { toast } from "sonner";

export interface MediaUploadToastResult {
	uploadedCount: number;
	localImportCount?: number;
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
	const toastPromise = toast.promise(
		async () => {
			await waitForNextPaint();
			return run();
		},
		{
			loading: `Importing ${getAssetLabel({ count: filesCount })}...`,
			success: ({
				uploadedCount,
				localImportCount = uploadedCount,
				assetNames,
			}) => {
				const localOnlyCount = Math.max(localImportCount - uploadedCount, 0);
				if (uploadedCount === 0 && localImportCount > 0) {
					return localImportCount === 1
						? "1 media asset imported"
						: `${localImportCount} media assets imported`;
				}
				if (localOnlyCount > 0) {
					return `${localImportCount} media assets imported`;
				}
				if (uploadedCount === 1) {
					const assetName = assetNames?.[0];
					return assetName
						? `${assetName} has been imported`
						: "1 media asset has been imported";
				}

				if (uploadedCount > 1) {
					return `${uploadedCount} media assets have been imported`;
				}

				return "No media assets were imported";
			},
			error: `Failed to import ${getAssetLabel({ count: filesCount })}`,
		},
	);

	return toastPromise.unwrap();
}
