import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { webEnv } from "@/env/web";

let _db: ReturnType<typeof drizzle> | null = null;

function databaseMaxConnections() {
	const raw = process.env.WEB_DATABASE_MAX_CONNECTIONS;
	const fallback = process.env.NODE_ENV === "development" ? 1 : 5;
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDb() {
	if (!_db) {
		const client = postgres(webEnv.DATABASE_URL, {
			idle_timeout: 20,
			max: databaseMaxConnections(),
			prepare: false,
		});
		_db = drizzle(client, { schema });
	}

	return _db;
}

export const db = getDb();

export * from "./schema";
