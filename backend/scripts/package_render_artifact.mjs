import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	readFile,
	readdir,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

const MARKERS = [
	"resolveRenderBackground",
	"applyRenderSurfaceStyles",
	"renderReady",
	"assertExportClean",
	"stripProhibitedRenderUI",
	"RenderRouteExclusions",
];

const [nextDirArg, outputDirArg] = process.argv.slice(2);
if (!nextDirArg || !outputDirArg) {
	throw new Error(
		"Usage: node package_render_artifact.mjs <apps/web/.next> <output-dir>",
	);
}

const nextDir = path.resolve(nextDirArg);
const outputDir = path.resolve(outputDirArg);
const sourceHtml = path.join(nextDir, "server", "app", "render.html");
const outputHtml = path.join(outputDir, "render.html");

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

await mkdir(path.join(outputDir, "_next"), { recursive: true });
await cp(sourceHtml, outputHtml);
await cp(path.join(nextDir, "static"), path.join(outputDir, "_next", "static"), {
	recursive: true,
});

const artifactFiles = await listFiles(outputDir);
const markerFiles = Object.fromEntries(MARKERS.map((marker) => [marker, []]));

for (const file of artifactFiles) {
	if (!/\.(?:html|js|map|css)$/.test(file)) continue;
	const contents = await readFile(file, "utf8");
	for (const marker of MARKERS) {
		if (contents.includes(marker)) {
			markerFiles[marker].push(path.relative(outputDir, file).replaceAll("\\", "/"));
		}
	}
}

const missingMarkers = MARKERS.filter((marker) => markerFiles[marker].length === 0);
if (missingMarkers.length > 0) {
	throw new Error(
		`Packaged render artifact is missing implementation markers: ${missingMarkers.join(", ")}`,
	);
}

const htmlBytes = await readFile(outputHtml);
const htmlStat = await stat(outputHtml);
const manifest = {
	source: "apps/web/src/app/render/page.tsx",
	implementation: "apps/web/src/app/render/render-client.tsx",
	buildCommand:
		"./apps/web/node_modules/.bin/next build && node backend/scripts/package_render_artifact.mjs apps/web/.next /render-dist",
	containerPath: "/app/frontend/out/render.html",
	artifact: "render.html",
	modifiedTimeUtc: htmlStat.mtime.toISOString(),
	sha256: createHash("sha256").update(htmlBytes).digest("hex"),
	markers: markerFiles,
};

await writeFile(
	path.join(outputDir, "render-artifact.json"),
	`${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(JSON.stringify(manifest, null, 2));
