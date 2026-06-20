import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const IMPLEMENTATION_VERSION = "capinsta-render-artifact:v1";

export const STABLE_IMPLEMENTATION_MARKERS = [
	"capinsta-render:background-resolution:v1",
	"capinsta-render:surface-styles:v1",
	"capinsta-render:readiness:v1",
	"capinsta-render:cleanliness:v1",
	"capinsta-render:prohibited-ui-stripping:v1",
	"capinsta-render:route-exclusions:v1",
];

export const REQUIRED_RUNTIME_CONTRACTS = [
	"__CAPINSTA_RENDER_ARTIFACT_MARKERS__",
	"setCaptionData",
	"setCaptionTime",
	"setCaptionFrame",
	"assertExportClean",
	"stripProhibitedRenderUI",
	"getRenderReadiness",
	"markRenderReady",
	"__EXPORT_APPLIED_BACKGROUND_COLOR__",
	"__EXPORT_APPLIED_RENDER_MODE__",
	"data-capinsta-export-overlay-root",
];

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
		else if (entry.isFile()) files.push(entryPath);
	}
	return files;
}

function emptyMatches(names) {
	return Object.fromEntries(names.map((name) => [name, []]));
}

async function findContracts({ files, outputDir, names }) {
	const matches = emptyMatches(names);
	for (const file of files) {
		if (!/\.(?:html|js|map|css)$/.test(file)) continue;
		const contents = await readFile(file, "utf8");
		for (const name of names) {
			if (contents.includes(name)) {
				matches[name].push(
					path.relative(outputDir, file).replaceAll("\\", "/"),
				);
			}
		}
	}
	return matches;
}

function assertContracts({ matches, label }) {
	const missing = Object.entries(matches)
		.filter(([, files]) => files.length === 0)
		.map(([name]) => name);
	if (missing.length > 0) {
		throw new Error(
			`Packaged render artifact is missing ${label}: ${missing.join(", ")}`,
		);
	}
}

async function hashArtifact(files, outputDir) {
	const hash = createHash("sha256");
	const relativeFiles = files
		.map((file) => ({
			file,
			relative: path.relative(outputDir, file).replaceAll("\\", "/"),
		}))
		.filter(({ relative }) => relative !== "render-artifact.json")
		.sort((left, right) => left.relative.localeCompare(right.relative));
	for (const { file, relative } of relativeFiles) {
		hash.update(relative);
		hash.update("\0");
		hash.update(await readFile(file));
		hash.update("\0");
	}
	return hash.digest("hex");
}

export async function packageRenderArtifact({
	nextDir: nextDirArg,
	outputDir: outputDirArg,
}) {
	const nextDir = path.resolve(nextDirArg);
	const outputDir = path.resolve(outputDirArg);
	const sourceHtml = path.join(nextDir, "server", "app", "render.html");
	const outputHtml = path.join(outputDir, "render.html");

	// Validate only a freshly copied artifact. Old hashed chunks must never
	// satisfy the current build's marker or runtime-contract checks.
	await rm(outputDir, { recursive: true, force: true });
	await mkdir(path.join(outputDir, "_next"), { recursive: true });
	await cp(sourceHtml, outputHtml);
	await cp(
		path.join(nextDir, "static"),
		path.join(outputDir, "_next", "static"),
		{
			recursive: true,
		},
	);

	const artifactFiles = await listFiles(outputDir);
	const stableMarkers = await findContracts({
		files: artifactFiles,
		outputDir,
		names: STABLE_IMPLEMENTATION_MARKERS,
	});
	const runtimeContracts = await findContracts({
		files: artifactFiles,
		outputDir,
		names: REQUIRED_RUNTIME_CONTRACTS,
	});

	assertContracts({
		matches: stableMarkers,
		label: "stable implementation markers",
	});
	assertContracts({
		matches: runtimeContracts,
		label: "required runtime contracts",
	});

	const htmlBytes = await readFile(outputHtml);
	const htmlStat = await stat(outputHtml);
	const manifest = {
		sourceRoute: "/render",
		sourceRouteFile: "apps/web/src/app/render/page.tsx",
		implementation: "apps/web/src/app/render/render-client.tsx",
		implementationVersion: IMPLEMENTATION_VERSION,
		buildCommand:
			"./apps/web/node_modules/.bin/next build && node backend/scripts/package_render_artifact.mjs apps/web/.next /render-dist",
		containerPath: "/app/frontend/out/render.html",
		artifact: "render.html",
		modifiedTimeUtc: htmlStat.mtime.toISOString(),
		// Retained for the backend health endpoint's existing HTML checksum.
		sha256: createHash("sha256").update(htmlBytes).digest("hex"),
		artifactSha256: await hashArtifact(artifactFiles, outputDir),
		stableMarkers,
		runtimeContracts,
	};

	await writeFile(
		path.join(outputDir, "render-artifact.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return manifest;
}

const isCli =
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
	const [nextDirArg, outputDirArg] = process.argv.slice(2);
	if (!nextDirArg || !outputDirArg) {
		throw new Error(
			"Usage: node package_render_artifact.mjs <apps/web/.next> <output-dir>",
		);
	}
	const manifest = await packageRenderArtifact({
		nextDir: nextDirArg,
		outputDir: outputDirArg,
	});
	console.log(JSON.stringify(manifest, null, 2));
}
