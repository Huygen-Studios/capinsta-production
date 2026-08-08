import "server-only";

import { webEnv } from "@/env/web";

export type DedicatedWorkerProvisioningState =
	| "pending"
	| "provisioning"
	| "active"
	| "failed"
	| "deprovisioning"
	| "cancelled";

export type DedicatedWorkerProvisioningRequest = {
	userId: string;
	subscriptionId: string;
	jobId?: string;
};

export type DedicatedWorkerProvisioningResult = {
	state: DedicatedWorkerProvisioningState;
	workerAssignment: Record<string, unknown>;
	lastError?: string | null;
};

export interface DedicatedWorkerProvisioningAdapter {
	name: "manual" | "external";
	requestProvisioning(
		request: DedicatedWorkerProvisioningRequest,
	): Promise<DedicatedWorkerProvisioningResult>;
	requestDeprovisioning(
		request: DedicatedWorkerProvisioningRequest,
	): Promise<DedicatedWorkerProvisioningResult>;
}

const manualAdapter: DedicatedWorkerProvisioningAdapter = {
	name: "manual",
	async requestProvisioning() {
		return {
			state: "pending",
			workerAssignment: { status: "awaiting_manual_infrastructure" },
		};
	},
	async requestDeprovisioning() {
		return {
			state: "deprovisioning",
			workerAssignment: { status: "awaiting_manual_deprovisioning" },
		};
	},
};

function createExternalAdapter(): DedicatedWorkerProvisioningAdapter {
	return {
		name: "external",
		async requestProvisioning(request) {
			return callExternalProvisioner({ action: "provision", request });
		},
		async requestDeprovisioning(request) {
			return callExternalProvisioner({ action: "deprovision", request });
		},
	};
}

async function callExternalProvisioner({
	action,
	request,
}: {
	action: "provision" | "deprovision";
	request: DedicatedWorkerProvisioningRequest;
}): Promise<DedicatedWorkerProvisioningResult> {
	const endpoint = webEnv.DEDICATED_WORKER_PROVISIONING_ENDPOINT;
	const token = webEnv.DEDICATED_WORKER_PROVISIONING_TOKEN;
	if (!endpoint || !token) {
		return {
			state: "failed",
			workerAssignment: { status: "external_adapter_not_configured" },
			lastError: "dedicated_worker_external_adapter_not_configured",
		};
	}

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ action, ...request }),
	});
	if (!response.ok) {
		return {
			state: "failed",
			workerAssignment: { status: "external_adapter_request_failed" },
			lastError: `external_adapter_http_${response.status}`,
		};
	}

	const payload: unknown = await response.json().catch(() => ({}));
	const assignment =
		payload && typeof payload === "object"
			? Object.fromEntries(Object.entries(payload))
			: {};
	return {
		state: action === "provision" ? "provisioning" : "deprovisioning",
		workerAssignment: assignment,
	};
}

export function getDedicatedWorkerProvisioningAdapter(): DedicatedWorkerProvisioningAdapter {
	if (webEnv.DEDICATED_WORKER_PROVISIONING_ADAPTER === "external") {
		return createExternalAdapter();
	}
	return manualAdapter;
}
