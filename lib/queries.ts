import type { Client } from "@libsql/client";
import { db } from "./db";
import type { Catalog, EnrollmentRecord, LearnerRecord } from "./rules";

export type Coach = { id: string; name: string; centerId: string; centerName: string };

export async function listCoaches(): Promise<Coach[]> {
  const { rows } = await (await db()).execute(
    `SELECT co.id, co.name, ce.id AS center_id, ce.name AS center_name
       FROM coaches co JOIN centers ce ON ce.id = co.center_id
      ORDER BY ce.name, co.name`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    centerId: String(r.center_id),
    centerName: String(r.center_name),
  }));
}

export async function getCoach(coachId: string): Promise<Coach | null> {
  return (await listCoaches()).find((c) => c.id === coachId) ?? null;
}

/** The shared catalog. Small by design, so it is loaded whole. */
export async function loadCatalog(client?: Client): Promise<Catalog> {
  const c = client ?? (await db());
  const [courses, skills, prereqs] = await Promise.all([
    c.execute("SELECT id, title, total_lessons FROM courses"),
    c.execute("SELECT course_id, skill_id FROM course_skills ORDER BY skill_id"),
    c.execute("SELECT course_id, prerequisite_id FROM course_prerequisites ORDER BY prerequisite_id"),
  ]);
  const catalog: Catalog = new Map();
  for (const r of courses.rows) {
    catalog.set(String(r.id), {
      id: String(r.id),
      title: String(r.title),
      totalLessons: Number(r.total_lessons),
      skills: [],
      prerequisites: [],
    });
  }
  for (const r of skills.rows) catalog.get(String(r.course_id))?.skills.push(String(r.skill_id));
  for (const r of prereqs.rows) catalog.get(String(r.course_id))?.prerequisites.push(String(r.prerequisite_id));
  return catalog;
}

/**
 * Learners whose *current* membership is in this center. This is the single
 * place that enforces "a coach sees only their center".
 */
export async function loadLearnersInCenter(centerId: string, onlyLearnerId?: string): Promise<LearnerRecord[]> {
  const c = await db();
  const filter = onlyLearnerId ? "AND l.id = ?" : "";
  const args = onlyLearnerId ? [centerId, onlyLearnerId] : [centerId];

  const learners = await c.execute({
    sql: `SELECT l.id, l.name, ce.id AS center_id, ce.name AS center_name, ce.timezone
            FROM learners l
            JOIN learner_center_memberships m ON m.learner_id = l.id AND m.ended_at IS NULL
            JOIN centers ce ON ce.id = m.center_id
           WHERE ce.id = ? ${filter}
           ORDER BY l.name`,
    args,
  });
  if (learners.rows.length === 0) return [];
  const ids = learners.rows.map((r) => String(r.id));
  const marks = ids.map(() => "?").join(",");

  const [goals, enrollments, activity, nudges, offered] = await Promise.all([
    c.execute({ sql: `SELECT learner_id, skill_id FROM learner_goals WHERE learner_id IN (${marks}) ORDER BY skill_id`, args: ids }),
    c.execute({
      sql: `SELECT id, learner_id, course_id, enrolled_at, completed_lessons
              FROM enrollments WHERE learner_id IN (${marks}) ORDER BY enrolled_at`,
      args: ids,
    }),
    c.execute({
      sql: `SELECT a.enrollment_id, a.occurred_at
              FROM activity_events a JOIN enrollments e ON e.id = a.enrollment_id
             WHERE e.learner_id IN (${marks})`,
      args: ids,
    }),
    c.execute({
      sql: `SELECT n.enrollment_id, MAX(n.created_at) AS last
              FROM coach_nudges n JOIN enrollments e ON e.id = n.enrollment_id
             WHERE e.learner_id IN (${marks})
             GROUP BY n.enrollment_id`,
      args: ids,
    }),
    c.execute({ sql: "SELECT course_id FROM center_courses WHERE center_id = ?", args: [centerId] }),
  ]);

  const activityBy = new Map<number, string[]>();
  for (const r of activity.rows) {
    const id = Number(r.enrollment_id);
    activityBy.set(id, [...(activityBy.get(id) ?? []), String(r.occurred_at)]);
  }
  const nudgeBy = new Map(nudges.rows.map((r) => [Number(r.enrollment_id), String(r.last)]));
  const offeredCourseIds = offered.rows.map((r) => String(r.course_id));

  return learners.rows.map((r) => {
    const id = String(r.id);
    const enrolls: EnrollmentRecord[] = enrollments.rows
      .filter((e) => String(e.learner_id) === id)
      .map((e) => ({
        enrollmentId: Number(e.id),
        courseId: String(e.course_id),
        enrolledAt: String(e.enrolled_at),
        completedLessons: Number(e.completed_lessons),
        activity: activityBy.get(Number(e.id)) ?? [],
        lastNudgedAt: nudgeBy.get(Number(e.id)) ?? null,
      }));
    return {
      id,
      name: String(r.name),
      centerId: String(r.center_id),
      centerName: String(r.center_name),
      timezone: String(r.timezone),
      goals: goals.rows.filter((g) => String(g.learner_id) === id).map((g) => String(g.skill_id)),
      offeredCourseIds,
      enrollments: enrolls,
    };
  });
}

export async function insertEnrollment(learnerId: string, courseId: string, centerId: string, at: Date) {
  await (await db()).execute({
    sql: `INSERT INTO enrollments (learner_id, course_id, center_id, enrolled_at, completed_lessons)
          VALUES (?, ?, ?, ?, 0)`,
    args: [learnerId, courseId, centerId, at.toISOString()],
  });
}

export async function insertNudge(coachId: string, enrollmentId: number, at: Date) {
  await (await db()).execute({
    sql: "INSERT INTO coach_nudges (coach_id, enrollment_id, created_at) VALUES (?, ?, ?)",
    args: [coachId, enrollmentId, at.toISOString()],
  });
}

/** Moves a learner to another center. Their enrollments and progress go with them. */
export async function moveLearner(learnerId: string, toCenterId: string, at: Date) {
  const iso = at.toISOString();
  await (await db()).batch(
    [
      { sql: "UPDATE learner_center_memberships SET ended_at = ? WHERE learner_id = ? AND ended_at IS NULL", args: [iso, learnerId] },
      { sql: "INSERT INTO learner_center_memberships (learner_id, center_id, started_at) VALUES (?, ?, ?)", args: [learnerId, toCenterId, iso] },
    ],
    "write",
  );
}
