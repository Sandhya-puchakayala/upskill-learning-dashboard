/**
 * Prints the raw database rows for one learner, to check what the dashboard shows.
 *
 *   npm run show-learner -- s4
 */
import { db } from "../lib/db";

async function main() {
  const learnerId = process.argv[2];
  if (!learnerId) throw new Error("Usage: npm run show-learner -- <learnerId>   (e.g. s1 ... s5)");
  const c = await db();
  const q = async (sql: string) => (await c.execute({ sql, args: [learnerId] })).rows;

  const [learner] = await q("SELECT id, name FROM learners WHERE id = ?");
  if (!learner) throw new Error(`No learner ${learnerId}`);
  console.log(`\n${learner.name} (${learner.id})`);

  console.log("\nGoals");
  console.table(await q("SELECT skill_id AS goal FROM learner_goals WHERE learner_id = ?"));

  console.log("Center membership");
  console.table(
    await q(`SELECT c.name AS center, m.started_at, IFNULL(m.ended_at, 'current') AS ended_at
               FROM learner_center_memberships m JOIN centers c ON c.id = m.center_id
              WHERE m.learner_id = ? ORDER BY m.started_at`),
  );

  console.log("Enrollments");
  const enrollments = await q(`SELECT e.course_id, co.title, e.enrolled_at, e.completed_lessons, co.total_lessons
                                 FROM enrollments e JOIN courses co ON co.id = e.course_id
                                WHERE e.learner_id = ? ORDER BY e.enrolled_at`);
  if (enrollments.length) console.table(enrollments);
  else console.log("  (none)\n");

  console.log("Activity events");
  const activity = await q(`SELECT e.course_id, a.occurred_at
                              FROM activity_events a JOIN enrollments e ON e.id = a.enrollment_id
                             WHERE e.learner_id = ? ORDER BY a.occurred_at`);
  if (activity.length) console.table(activity);
  else console.log("  (none)\n");

  console.log("Coach nudges");
  const nudges = await q(`SELECT e.course_id, n.coach_id, n.created_at
                            FROM coach_nudges n JOIN enrollments e ON e.id = n.enrollment_id
                           WHERE e.learner_id = ? ORDER BY n.created_at`);
  if (nudges.length) console.table(nudges);
  else console.log("  (none)\n");

  console.log("Times are stored in UTC (IST = UTC + 5:30).");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
