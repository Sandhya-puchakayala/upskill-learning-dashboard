/**
 * Rebuilds the database from db/schema.sql and the JSON in seed/.
 *
 *   npm run db:reset
 */
import { db } from "../lib/db";
import { seedDatabase } from "../lib/seed";

async function main() {
  const client = await db();
  await seedDatabase(client);

  const count = async (t: string) => (await client.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
  console.log(
    `Seeded: ${await count("learners")} learners, ${await count("courses")} courses, ` +
      `${await count("enrollments")} enrollments, ${await count("activity_events")} activity events, ` +
      `${await count("centers")} centers.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
