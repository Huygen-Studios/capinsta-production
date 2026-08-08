import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	packageRenderArtifact,
	REQUIRED_RUNTIME_CONTRACTS,
	STABLE_IMPLEMENTATION_MARKERS,
} from "./package_render_artifact.mjs";

const fixtureRoots: string[] = [];

async function createFixture({
	omitMarkers = [],
	includeSourceNames = false,
}: {
	omitMarkers?: string[];
	includeSourceNames?: boolean;
} = {}) {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "capinsta-render-artifact-"),
	);
	fixtureRoots.push(root);
	const nextDir = path.join(root, ".next");
	const outputDir = path.join(root, "render-dist");
	const staticDir = path.join(nextDir, "static", "chunks");
	await mkdir(path.join(nextDir, "server", "app"), { recursive: true });
	await mkdir(staticDir, { recursive: true });
	await writeFile(
		path.join(nextDir, "server", "app", "render.html"),
		'<html><body><script src="/_next/static/chunks/render.js"></script></body></html>',
	);
	const markers = STABLE_IMPLEMENTATION_MARKERS.filter(
		(marker) => !omitMarkers.includes(marker),
	);
	const sourceNames = includeSourceNames
		? ["resolveRenderBackground", "applyRenderSurfaceStyles"]
		: ["a", "b"];
	await writeFile(
		path.join(staticDir, "render.js"),
		JSON.stringify({
			markers,
			runtime: REQUIRED_RUNTIME_CONTRACTS,
			sourceNames,
		}),
	);
	return { nextDir, outputDir };
}

afterEach(async () => {
	await Promise.all(
		fixtureRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("packageRenderArtifact", () => {
	test("packages a compiled fixture containing stable markers", async () => {
		const fixture = await createFixture({ includeSourceNames: true });
		const manifest = await packageRenderArtifact(fixture);

		expect(manifest.sourceRoute).toBe("/render");
		expect(manifest.implementationVersion).toBe("capinsta-render-artifact:v1");
		expect(manifest.artifactSha256).toHaveLength(64);
		expect(manifest.stableMarkers[STABLE_IMPLEMENTATION_MARKERS[0]]).toContain(
			"_next/static/chunks/render.js",
		);
	});

	test("fails when the background-resolution marker is missing", async () => {
		const fixture = await createFixture({
			omitMarkers: ["capinsta-render:background-resolution:v1"],
		});
		await expect(packageRenderArtifact(fixture)).rejects.toThrow(
			"capinsta-render:background-resolution:v1",
		);
	});

	test("fails when the surface-style marker is missing", async () => {
		const fixture = await createFixture({
			omitMarkers: ["capinsta-render:surface-styles:v1"],
		});
		await expect(packageRenderArtifact(fixture)).rejects.toThrow(
			"capinsta-render:surface-styles:v1",
		);
	});

	test("passes when source names are minified but stable markers remain", async () => {
		const fixture = await createFixture({ includeSourceNames: false });
		const manifest = await packageRenderArtifact(fixture);
		const chunk = await readFile(
			path.join(fixture.outputDir, "_next", "static", "chunks", "render.js"),
			"utf8",
		);

		expect(chunk).not.toContain("resolveRenderBackground");
		expect(chunk).not.toContain("applyRenderSurfaceStyles");
		expect(manifest.stableMarkers).toBeDefined();
	});

	test("does not allow stale output files to satisfy validation", async () => {
		const fixture = await createFixture({
			omitMarkers: ["capinsta-render:background-resolution:v1"],
		});
		await mkdir(fixture.outputDir, { recursive: true });
		await writeFile(
			path.join(fixture.outputDir, "stale.js"),
			"capinsta-render:background-resolution:v1",
		);

		await expect(packageRenderArtifact(fixture)).rejects.toThrow(
			"capinsta-render:background-resolution:v1",
		);
		await expect(
			readFile(path.join(fixture.outputDir, "stale.js"), "utf8"),
		).rejects.toThrow();
	});
});
