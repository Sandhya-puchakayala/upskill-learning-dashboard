/**
 * Moves a learner to another center. Enrollments, progress and skills stay.
 *
 *   npm run move-learner -- s3 ctr_pun
 */
import { db } from "../lib/db";
import { moveLearner } from "../lib/queries";

async function main() {
  const [learnerId, centerId] = process.argv.slice(2);
  if (!learnerId || !centerId) throw new Error("Usage: npm run move-learner -- <learnerId> <centerId>");
  await moveLearner(learnerId, centerId, new Date());

  const { rows } = await (await db()).execute({
    sql: `SELECT c.name, m.started_at, m.ended_at
            FROM learner_center_memberships m JOIN centers c ON c.id = m.center_id
           WHERE m.learner_id = ? ORDER BY m.started_at`,
    args: [learnerId],
  });
  console.table(rows.map((r) => ({ center: r.name, from: r.started_at, to: r.ended_at ?? "now" })));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
