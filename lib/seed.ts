/**
 * Builds the database from db/schema.sql and the JSON in seed/.
 * The JSON is only an import format; after this runs, the app reads tables only.
 *
 * Used by `npm run db:reset` and, on first start, by lib/db.ts when the
 * database is empty (e.g. a fresh deploy).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client, InStatement } from "@libsql/client";
import courses from "../seed/courses.json";
import seedEnrollments from "../seed/enrollments.json";
import extra from "../seed/extra.json";
import seedProgress from "../seed/progress.json";
import students from "../seed/students.json";

// Provided seed first, then our clearly marked additions from extra.json.
const enrollments = [...seedEnrollments, ...extra.enrollments];
const progress = [...seedProgress, ...extra.progress];

/** Store every timestamp as UTC ISO so string comparison == time comparison. */
const utc = (iso: string) => new Date(iso).toISOString();

function seedStatements(): InStatement[] {
  const allStudents = [...students, ...extra.students];

  // totalLessons arrives on progress rows but belongs to the course.
  const totalLessons = new Map<string, number>();
  for (const p of progress) {
    const seen = totalLessons.get(p.courseId);
    if (seen !== undefined && seen !== p.totalLessons) {
      throw new Error(`Conflicting totalLessons for ${p.courseId}: ${seen} vs ${p.totalLessons}`);
    }
    totalLessons.set(p.courseId, p.totalLessons);
  }
  for (const c of courses) {
    if (!totalLessons.has(c.id)) throw new Error(`No lesson count for course ${c.id}`);
  }

  const skills = new Set<string>();
  for (const c of courses) c.skillsTaught.forEach((s) => skills.add(s));
  for (const s of allStudents) s.goals.forEach((g) => skills.add(g));

  const stmts: InStatement[] = [];
  const add = (sql: string, args: (string | number | null)[] = []) => stmts.push({ sql, args });

  for (const s of skills) add("INSERT INTO skills (id, name) VALUES (?, ?)", [s, s]);
  for (const c of courses) {
    add("INSERT INTO courses (id, title, total_lessons) VALUES (?, ?, ?)", [c.id, c.title, totalLessons.get(c.id)!]);
  }
  for (const c of courses) {
    for (const s of c.skillsTaught) add("INSERT INTO course_skills VALUES (?, ?)", [c.id, s]);
    for (const p of c.prerequisites) add("INSERT INTO course_prerequisites VALUES (?, ?)", [c.id, p]);
  }

  for (const s of allStudents) {
    add("INSERT INTO learners (id, name) VALUES (?, ?)", [s.id, s.name]);
    for (const g of s.goals) add("INSERT INTO learner_goals VALUES (?, ?)", [s.id, g]);
  }

  for (const c of extra.centers) {
    add("INSERT INTO centers (id, name, timezone) VALUES (?, ?, ?)", [c.id, c.name, c.timezone]);
    for (const courseId of c.courses) add("INSERT INTO center_courses VALUES (?, ?)", [c.id, courseId]);
  }
  for (const c of extra.coaches) {
    add("INSERT INTO coaches (id, name, center_id) VALUES (?, ?, ?)", [c.id, c.name, c.centerId]);
  }
  const centerOf = new Map<string, string>();
  for (const m of extra.memberships) {
    centerOf.set(m.studentId, m.centerId);
    add("INSERT INTO learner_center_memberships (learner_id, center_id, started_at) VALUES (?, ?, ?)", [
      m.studentId,
      m.centerId,
      utc(m.startedAt),
    ]);
  }

  for (const e of enrollments) {
    const p = progress.find((x) => x.studentId === e.studentId && x.courseId === e.courseId);
    const center = centerOf.get(e.studentId);
    if (!center) throw new Error(`Student ${e.studentId} has no center`);
    add(
      "INSERT INTO enrollments (learner_id, course_id, center_id, enrolled_at, completed_lessons) VALUES (?, ?, ?, ?, ?)",
      [e.studentId, e.courseId, center, utc(e.enrolledAt), p?.completedLessons ?? 0],
    );
    // The seed only has the last activity per course; it becomes one event.
    if (p) {
      add(
        `INSERT INTO activity_events (enrollment_id, occurred_at)
         SELECT id, ? FROM enrollments WHERE learner_id = ? AND course_id = ?`,
        [utc(p.lastActiveAt), e.studentId, e.courseId],
      );
    }
  }
  return stmts;
}

/** Drops and recreates every table, then loads the seed. */
export async function seedDatabase(client: Client): Promise<void> {
  const stmts = seedStatements(); // validate the seed before touching the database
  await client.executeMultiple(readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"));
  await client.batch(stmts, "write");
}
