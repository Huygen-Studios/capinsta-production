import { sql, type SQL } from "drizzle-orm";
import { DEFAULT_PIPELINE_OPTIONS, mergePipelineOptions } from "@/transcription/provider-catalog";

/* eslint-disable opencut/prefer-object-params */

type QueryExecutor = {
	execute(query: SQL<unknown>): Promise<unknown>;
};

export type AdminTranscriptionConfigurationRecord = {
	id: string;
	provider: string;
	model: string;
	providerOptions: Record<string, unknown>;
	pipelineOptions: Record<string, unknown>;
	presetId: string | null;
	presetVersion: number | null;
	pipelineOptionSources: Record<string, unknown>;
	timestampStrategy: string;
	strictProvider: boolean;
	status: string;
	version: number;
	testStatus: string;
	testedAt: Date | null;
	testedBy: string | null;
	testErrorCode: string | null;
	testLatencyMs: number | null;
	activatedAt: Date | null;
	activatedBy: string | null;
	activationReason: string | null;
	createdAt: Date;
	updatedAt: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIterable(value: unknown): value is Iterable<unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		Symbol.iterator in value &&
		typeof value[Symbol.iterator] === "function"
	);
}

function rowsFrom(result: unknown): Record<string, unknown>[] {
	if (Array.isArray(result)) return result.filter(isRecord);
	if (isRecord(result)) {
		const rows = result.rows;
		if (Array.isArray(rows)) return rows.filter(isRecord);
	}
	if (isIterable(result)) {
		return Array.from(result).filter(isRecord);
	}
	return [];
}

function toDate(value: unknown): Date | null {
	if (value instanceof Date) return value;
	if (typeof value === "string" || typeof value === "number") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
}

function coerceConfig(row: Record<string, unknown>): AdminTranscriptionConfigurationRecord {
	return {
		id: String(row.id),
		provider: String(row.provider),
		model: String(row.model),
		providerOptions: isRecord(row.providerOptions) ? row.providerOptions : {},
		pipelineOptions: mergePipelineOptions(
			DEFAULT_PIPELINE_OPTIONS,
			isRecord(row.pipelineOptions) ? row.pipelineOptions : {},
		),
		presetId: row.presetId ? String(row.presetId) : null,
		presetVersion:
			typeof row.presetVersion === "number" ? row.presetVersion : null,
		pipelineOptionSources: isRecord(row.pipelineOptionSources)
			? row.pipelineOptionSources
			: {},
		timestampStrategy: String(row.timestampStrategy),
		strictProvider: row.strictProvider !== false,
		status: String(row.status),
		version: Number(row.version ?? 1),
		testStatus: String(row.testStatus ?? "untested"),
		testedAt: toDate(row.testedAt),
		testedBy: row.testedBy ? String(row.testedBy) : null,
		testErrorCode: row.testErrorCode ? String(row.testErrorCode) : null,
		testLatencyMs:
			typeof row.testLatencyMs === "number" ? row.testLatencyMs : null,
		activatedAt: toDate(row.activatedAt),
		activatedBy: row.activatedBy ? String(row.activatedBy) : null,
		activationReason: row.activationReason ? String(row.activationReason) : null,
		createdAt: toDate(row.createdAt) ?? new Date(0),
		updatedAt: toDate(row.updatedAt) ?? new Date(0),
	};
}

export async function transcriptionPipelineOptionsColumnExists(
	executor: QueryExecutor,
): Promise<boolean> {
	const result = await executor.execute(sql`
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
				and table_name = 'transcription_configurations'
				and column_name = 'pipeline_options'
		) as exists
	`);
	return rowsFrom(result)[0]?.exists === true;
}

export async function transcriptionPresetColumnsExist(
	executor: QueryExecutor,
): Promise<boolean> {
	const result = await executor.execute(sql`
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
				and table_name = 'transcription_configurations'
				and column_name = 'preset_id'
		) as exists
	`);
	return rowsFrom(result)[0]?.exists === true;
}

export async function listAdminTranscriptionConfigurations(
	executor: QueryExecutor,
	limit = 20,
): Promise<AdminTranscriptionConfigurationRecord[]> {
	const hasPipelineOptions = await transcriptionPipelineOptionsColumnExists(executor);
	const hasPresetColumns = await transcriptionPresetColumnsExist(executor);
	const presetSelect = hasPresetColumns
		? sql`preset_id as "presetId", preset_version as "presetVersion", pipeline_option_sources as "pipelineOptionSources",`
		: sql`null::text as "presetId", null::int as "presetVersion", '{}'::jsonb as "pipelineOptionSources",`;
	const result = hasPipelineOptions
		? await executor.execute(sql`
			select
				id::text as id,
				provider,
				model,
				provider_options as "providerOptions",
				pipeline_options as "pipelineOptions",
				${presetSelect}
				timestamp_strategy as "timestampStrategy",
				strict_provider as "strictProvider",
				status,
				version,
				test_status as "testStatus",
				tested_at as "testedAt",
				tested_by::text as "testedBy",
				test_error_code as "testErrorCode",
				test_latency_ms as "testLatencyMs",
				activated_at as "activatedAt",
				activated_by::text as "activatedBy",
				activation_reason as "activationReason",
				created_at as "createdAt",
				updated_at as "updatedAt"
			from transcription_configurations
			order by updated_at desc
			limit ${limit}
		`)
		: await executor.execute(sql`
			select
				id::text as id,
				provider,
				model,
				provider_options as "providerOptions",
				null::jsonb as "pipelineOptions",
				${presetSelect}
				timestamp_strategy as "timestampStrategy",
				strict_provider as "strictProvider",
				status,
				version,
				test_status as "testStatus",
				tested_at as "testedAt",
				tested_by::text as "testedBy",
				test_error_code as "testErrorCode",
				test_latency_ms as "testLatencyMs",
				activated_at as "activatedAt",
				activated_by::text as "activatedBy",
				activation_reason as "activationReason",
				created_at as "createdAt",
				updated_at as "updatedAt"
			from transcription_configurations
			order by updated_at desc
			limit ${limit}
		`);
	return rowsFrom(result).map(coerceConfig);
}

export async function getAdminTranscriptionConfiguration(
	executor: QueryExecutor,
	id: string,
): Promise<AdminTranscriptionConfigurationRecord | null> {
	const hasPipelineOptions = await transcriptionPipelineOptionsColumnExists(executor);
	const hasPresetColumns = await transcriptionPresetColumnsExist(executor);
	const presetSelect = hasPresetColumns
		? sql`preset_id as "presetId", preset_version as "presetVersion", pipeline_option_sources as "pipelineOptionSources",`
		: sql`null::text as "presetId", null::int as "presetVersion", '{}'::jsonb as "pipelineOptionSources",`;
	const result = hasPipelineOptions
		? await executor.execute(sql`
			select
				id::text as id,
				provider,
				model,
				provider_options as "providerOptions",
				pipeline_options as "pipelineOptions",
				${presetSelect}
				timestamp_strategy as "timestampStrategy",
				strict_provider as "strictProvider",
				status,
				version,
				test_status as "testStatus",
				tested_at as "testedAt",
				tested_by::text as "testedBy",
				test_error_code as "testErrorCode",
				test_latency_ms as "testLatencyMs",
				activated_at as "activatedAt",
				activated_by::text as "activatedBy",
				activation_reason as "activationReason",
				created_at as "createdAt",
				updated_at as "updatedAt"
			from transcription_configurations
			where id = ${id}::uuid
			limit 1
		`)
		: await executor.execute(sql`
			select
				id::text as id,
				provider,
				model,
				provider_options as "providerOptions",
				null::jsonb as "pipelineOptions",
				${presetSelect}
				timestamp_strategy as "timestampStrategy",
				strict_provider as "strictProvider",
				status,
				version,
				test_status as "testStatus",
				tested_at as "testedAt",
				tested_by::text as "testedBy",
				test_error_code as "testErrorCode",
				test_latency_ms as "testLatencyMs",
				activated_at as "activatedAt",
				activated_by::text as "activatedBy",
				activation_reason as "activationReason",
				created_at as "createdAt",
				updated_at as "updatedAt"
			from transcription_configurations
			where id = ${id}::uuid
			limit 1
		`);
	return rowsFrom(result).map(coerceConfig)[0] ?? null;
}
