import { createClient, type Client } from "@libsql/client";
import { seedDatabase } from "./seed";

let ready: Promise<Client> | undefined;

/**
 * Where the data lives:
 * - DATABASE_URL if set (e.g. a Turso database for a deploy),
 * - otherwise a local file. Serverless hosts only allow writes under /tmp.
 */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return process.env.VERCEL ? "file:/tmp/upskill.db" : "file:upskill.db";
}

/** Shared libSQL client. Seeds the database on first use if it has no tables. */
export function db(): Promise<Client> {
  if (!ready) {
    ready = (async () => {
      const client = createClient({ url: databaseUrl(), authToken: process.env.DATABASE_AUTH_TOKEN });
      await client.execute("PRAGMA foreign_keys = ON");
      const { rows } = await client.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'learners'");
      if (rows.length === 0) await seedDatabase(client);
      return client;
    })();
    // Let the next request retry instead of caching a failure forever.
    ready.catch(() => {
      ready = undefined;
    });
  }
  return ready;
}
