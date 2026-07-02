import { readFileSync, writeFileSync } from "node:fs";

type EslintMessage = {
	ruleId: string | null;
	severity: 1 | 2;
	message: string;
	line: number;
	column: number;
};

type EslintFileResult = {
	filePath: string;
	messages: EslintMessage[];
	errorCount: number;
	warningCount: number;
};

const strictPathPrefixes = [
	"src/auth/",
	"src/app/auth/",
	"src/billing/",
	"src/app/account/",
	"src/app/api/account/",
	"src/app/api/billing/",
	"src/app/api/donations/",
	"src/app/donate/",
	"src/app/pricing/",
	"src/components/auth/",
	"src/components/billing/",
	"src/db/schema.ts",
	"src/env/web.ts",
	"src/test/setup.ts",
];

type BaselineRow = {
	file: string;
	errors: number;
	warnings: number;
	messages: Array<{
		ruleId: string | null;
		severity: 1 | 2;
		line: number;
		column: number;
	}>;
};

type LintBaseline = {
	version: 1;
	errors: number;
	warnings: number;
	files: number;
	rows: BaselineRow[];
};

function normalizePath(path: string) {
	return path.replace(/\\/g, "/");
}

async function commandOutput(command: string[]) {
	const proc = Bun.spawn(command, {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

async function changedSourceFiles() {
	const tracked = await commandOutput([
		"git",
		"diff",
		"--name-only",
		"--diff-filter=ACMRT",
		"HEAD",
	]);
	const untracked = await commandOutput([
		"git",
		"ls-files",
		"--others",
		"--exclude-standard",
	]);
	const files = new Set<string>();
	for (const output of [tracked.stdout, untracked.stdout]) {
		for (const raw of output.split(/\r?\n/)) {
			const file = normalizePath(raw.trim());
			if (file.startsWith("apps/web/src/") && /\.(ts|tsx)$/.test(file)) {
				files.add(file.replace("apps/web/", ""));
			}
		}
	}
	return files;
}

function isStrictFile(relativePath: string, changedFiles: Set<string>) {
	if (changedFiles.has(relativePath)) return true;
	return strictPathPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function formatMessage(relativePath: string, message: EslintMessage) {
	return `${relativePath}:${message.line}:${message.column} ${message.ruleId ?? "unknown"} ${message.message}`;
}

const changedFiles = await changedSourceFiles();
const eslint = await commandOutput([
	"bunx",
	"eslint",
	"src",
	"--ext",
	".ts,.tsx",
	"--format",
	"json",
]);

let results: EslintFileResult[];
try {
	results = JSON.parse(eslint.stdout) as EslintFileResult[];
} catch {
	console.error(eslint.stdout);
	console.error(eslint.stderr);
	process.exit(eslint.exitCode || 1);
}

const strictFailures: string[] = [];
let baselineErrorCount = 0;
let baselineWarningCount = 0;
const baselineRows: BaselineRow[] = [];

for (const result of results) {
	const relativePath = normalizePath(result.filePath).split("/apps/web/").pop() ?? normalizePath(result.filePath);
	const strict = isStrictFile(relativePath, changedFiles);
	for (const message of result.messages) {
		if (strict) {
			strictFailures.push(formatMessage(relativePath, message));
			continue;
		}
	}
	if (!strict && result.messages.length > 0) {
		baselineRows.push({
			file: relativePath,
			errors: result.errorCount,
			warnings: result.warningCount,
			messages: result.messages.map((message) => {
				if (message.severity === 2) baselineErrorCount += 1;
				if (message.severity === 1) baselineWarningCount += 1;
				return {
					ruleId: message.ruleId,
					severity: message.severity,
					line: message.line,
					column: message.column,
				};
			}),
		});
	}
}

if (strictFailures.length > 0) {
	console.error("ESLint failed in changed or auth/billing/payment-protected files:");
	for (const failure of strictFailures) console.error(`- ${failure}`);
	process.exit(1);
}

baselineRows.sort((left, right) => left.file.localeCompare(right.file));
const currentBaseline: LintBaseline = {
	version: 1,
	errors: baselineErrorCount,
	warnings: baselineWarningCount,
	files: baselineRows.length,
	rows: baselineRows,
};

if (process.env.UPDATE_ESLINT_BASELINE === "true") {
	writeFileSync("eslint-baseline.json", `${JSON.stringify(currentBaseline, null, "\t")}\n`);
	console.warn(
		`Updated ESLint baseline intentionally: ${currentBaseline.errors} errors and ${currentBaseline.warnings} warnings across ${currentBaseline.files} files.`,
	);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync("eslint-baseline.json", "utf8")) as LintBaseline;

if (JSON.stringify(currentBaseline) !== JSON.stringify(baseline)) {
	console.error("ESLint baseline changed. Update eslint-baseline.json intentionally after reviewing the diff.");
	console.error(
		`Current baseline: ${currentBaseline.errors} errors and ${currentBaseline.warnings} warnings across ${currentBaseline.files} files.`,
	);
	console.error(
		`Documented baseline: ${baseline.errors} errors and ${baseline.warnings} warnings across ${baseline.files} files.`,
	);
	process.exit(1);
}

if (baselineErrorCount > 0 || baselineWarningCount > 0) {
	console.warn(
		`ESLint existing-debt baseline unchanged: ${baselineErrorCount} errors and ${baselineWarningCount} warnings across ${baselineRows.length} unrelated files.`,
	);
	console.warn(
		"Changed files plus auth/billing/payment protected paths are lint-clean. Run `bun run lint:raw` for the full baseline list.",
	);
} else {
	console.log("ESLint passed with no baseline debt.");
}
