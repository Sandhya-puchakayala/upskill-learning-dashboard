import { createClient, type Client } from "@libsql/client";

let ready: Promise<Client> | undefined;

/** Shared libSQL client. Local file by default, Turso when DATABASE_URL is remote. */
export function db(): Promise<Client> {
  if (!ready) {
    const client = createClient({
      url: process.env.DATABASE_URL ?? "file:upskill.db",
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    ready = client.execute("PRAGMA foreign_keys = ON").then(() => client);
  }
  return ready;
}
