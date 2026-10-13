/**
 * Business rules. Pure functions: no I/O, no clock. The caller passes `asOf`.
 *
 * - Skill earned: the course that teaches it is >= 80% complete.
 * - Course complete (for prerequisites): 100% of lessons done.
 * - Eligible: offered at the learner's center, and every prerequisite complete.
 * - At-risk: an unfinished course with no activity for more than 3 calendar
 *   days (counted in the center's timezone). Exactly 3 days is still on track.
 * - Active days: distinct calendar days with activity in the 7 days ending on asOf.
 */

export const SKILL_THRESHOLD_PERCENT = 80;
export const AT_RISK_AFTER_DAYS = 3;
export const ACTIVE_WINDOW_DAYS = 7;

export type CourseDef = {
  id: string;
  title: string;
  totalLessons: number;
  skills: string[];
  prerequisites: string[];
};
export type Catalog = Map<string, CourseDef>;

export type EnrollmentRecord = {
  enrollmentId: number;
  courseId: string;
  enrolledAt: string; // ISO
  completedLessons: number;
  activity: string[]; // ISO timestamps
  lastNudgedAt: string | null;
};

export type LearnerRecord = {
  id: string;
  name: string;
  centerId: string;
  centerName: string;
  timezone: string;
  goals: string[];
  offeredCourseIds: string[];
  enrollments: EnrollmentRecord[];
};

export type CourseStatus = "completed" | "on-track" | "at-risk";

export type CourseView = {
  enrollmentId: number;
  courseId: string;
  title: string;
  skills: string[];
  completedLessons: number;
  totalLessons: number;
  percent: number;
  status: CourseStatus;
  lastActiveAt: string;
  lastActiveIsEnrollment: boolean;
  daysInactive: number;
  missingPrerequisites: string[]; // titles
  lastNudgedAt: string | null;
};

export type Recommendation =
  | { kind: "enroll"; courseId: string; title: string; reason: string }
  | { kind: "resume"; courseId: string; title: string; reason: string }
  | { kind: "none"; reason: string };

export type LearnerStatus = "at-risk" | "no-courses" | "on-track" | "completed";

export type LearnerView = {
  id: string;
  name: string;
  centerName: string;
  timezone: string;
  goals: { skill: string; earned: boolean }[];
  earnedSkills: { skill: string; fromCourse: string }[];
  activeDays: { count: number; days: { date: string; active: boolean }[] };
  courses: CourseView[];
  recommendation: Recommendation;
  status: LearnerStatus;
  maxDaysInactive: number | null;
};

// ---------------------------------------------------------------------------
// Course-level rules
// ---------------------------------------------------------------------------

/** Rounded down, so 99.9% never shows as 100%. */
export function percentComplete(completed: number, total: number): number {
  return Math.floor((completed * 100) / total);
}

export function isComplete(completed: number, total: number): boolean {
  return completed >= total;
}

/** Integer math: avoids 0.8 floating-point edge cases. */
export function earnsSkills(completed: number, total: number): boolean {
  return completed * 100 >= total * SKILL_THRESHOLD_PERCENT;
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant in a timezone. */
export function localDay(instant: string | Date, timeZone: string): string {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt.format(typeof instant === "string" ? new Date(instant) : instant);
}

/** Whole calendar days from day `a` to day `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const ms = (iso: string) => Date.parse(iso);

/**
 * Most recent activity at or before asOf. A course with no activity yet counts
 * from its enrollment date, so a new enrollment starts "on track" and turns
 * at-risk if nobody starts it.
 */
export function lastActive(e: EnrollmentRecord, asOf: Date): { at: string; fromEnrollment: boolean } {
  const past = e.activity.filter((a) => ms(a) <= asOf.getTime());
  if (past.length) {
    return { at: past.reduce((x, y) => (ms(y) > ms(x) ? y : x)), fromEnrollment: false };
  }
  return { at: e.enrolledAt, fromEnrollment: true };
}

export function courseStatus(completed: number, total: number, daysInactive: number): CourseStatus {
  if (isComplete(completed, total)) return "completed";
  return daysInactive > AT_RISK_AFTER_DAYS ? "at-risk" : "on-track";
}

export function activeDays(learner: LearnerRecord, asOf: Date) {
  const today = localDay(asOf, learner.timezone);
  const start = addDays(today, -(ACTIVE_WINDOW_DAYS - 1));
  const active = new Set<string>();
  for (const e of learner.enrollments) {
    for (const a of e.activity) {
      if (ms(a) > asOf.getTime()) continue;
      const day = localDay(a, learner.timezone);
      if (day >= start && day <= today) active.add(day);
    }
  }
  const days = Array.from({ length: ACTIVE_WINDOW_DAYS }, (_, i) => {
    const date = addDays(start, i);
    return { date, active: active.has(date) };
  });
  return { count: active.size, days };
}

// ---------------------------------------------------------------------------
// Learner-level rules
// ---------------------------------------------------------------------------

function enrollmentMap(learner: LearnerRecord) {
  return new Map(learner.enrollments.map((e) => [e.courseId, e]));
}

export function earnedSkills(learner: LearnerRecord, catalog: Catalog) {
  const earned = new Map<string, string>();
  for (const e of learner.enrollments) {
    const course = catalog.get(e.courseId);
    if (!course || !earnsSkills(e.completedLessons, course.totalLessons)) continue;
    for (const s of course.skills) if (!earned.has(s)) earned.set(s, course.title);
  }
  return earned;
}

function completedCourseIds(learner: LearnerRecord, catalog: Catalog): Set<string> {
  const done = new Set<string>();
  for (const e of learner.enrollments) {
    const c = catalog.get(e.courseId);
    if (c && isComplete(e.completedLessons, c.totalLessons)) done.add(e.courseId);
  }
  return done;
}

export function missingPrerequisites(courseId: string, learner: LearnerRecord, catalog: Catalog): string[] {
  const done = completedCourseIds(learner, catalog);
  return (catalog.get(courseId)?.prerequisites ?? []).filter((p) => !done.has(p));
}

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: "unknown-course" | "already-enrolled" | "not-offered" | "missing-prerequisites"; missing?: string[] };

/** Can this learner enroll in this course right now? */
export function checkEligibility(courseId: string, learner: LearnerRecord, catalog: Catalog): Eligibility {
  if (!catalog.has(courseId)) return { eligible: false, reason: "unknown-course" };
  if (learner.enrollments.some((e) => e.courseId === courseId)) return { eligible: false, reason: "already-enrolled" };
  if (!learner.offeredCourseIds.includes(courseId)) return { eligible: false, reason: "not-offered" };
  const missing = missingPrerequisites(courseId, learner, catalog);
  if (missing.length) return { eligible: false, reason: "missing-prerequisites", missing };
  return { eligible: true };
}

/** Every course that must be finished before `courseId` (transitive). */
export function ancestors(courseId: string, catalog: Catalog): Set<string> {
  const out = new Set<string>();
  const stack = [...(catalog.get(courseId)?.prerequisites ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(catalog.get(id)?.prerequisites ?? []));
  }
  return out;
}

const listJoin = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const byId = (a: CourseDef, b: CourseDef) => a.id.localeCompare(b.id);

/**
 * One next step, in priority order:
 *  1. Enroll: an eligible, unenrolled course that teaches an unmet goal.
 *  2. Enroll: an eligible, unenrolled course that unlocks a goal course.
 *  3. Resume: an unfinished enrolled course on a goal path (prefer ones the
 *     learner can work on now, then ones blocking a goal course, then the
 *     furthest along).
 *  4. None, with the reason.
 */
export function recommend(learner: LearnerRecord, catalog: Catalog, asOf: Date): Recommendation {
  if (learner.goals.length === 0) {
    return { kind: "none", reason: "No goals set yet. Add a goal to get a recommendation." };
  }
  const earned = earnedSkills(learner, catalog);
  const openGoals = learner.goals.filter((g) => !earned.has(g));
  if (openGoals.length === 0) {
    return { kind: "none", reason: "Every goal skill is earned. Time to set a new goal." };
  }

  const enrolled = enrollmentMap(learner);
  const done = completedCourseIds(learner, catalog);
  const courses = [...catalog.values()].sort(byId);
  const eligible = (c: CourseDef) => checkEligibility(c.id, learner, catalog).eligible;
  const goalsTaught = (c: CourseDef) => openGoals.filter((g) => c.skills.includes(g));

  // 1. Directly teaches an open goal.
  const direct = courses
    .filter((c) => eligible(c) && goalsTaught(c).length > 0)
    .sort((a, b) => goalsTaught(b).length - goalsTaught(a).length || a.totalLessons - b.totalLessons);
  if (direct.length) {
    const c = direct[0];
    const goals = goalsTaught(c);
    const prereq = c.prerequisites.length ? "Prerequisites are done." : "No prerequisites needed.";
    return {
      kind: "enroll",
      courseId: c.id,
      title: c.title,
      reason: `Teaches ${listJoin(goals)}, ${goals.length > 1 ? `${goals.length} of your goals` : "your goal"}. ${prereq}`,
    };
  }

  // Unfinished courses that teach an open goal, and what they need first.
  const goalTargets = courses.filter((c) => !done.has(c.id) && goalsTaught(c).length > 0);
  const unlocks = new Map<string, CourseDef>(); // prerequisite id -> goal course it leads to
  for (const t of goalTargets) {
    for (const a of ancestors(t.id, catalog)) if (!done.has(a) && !unlocks.has(a)) unlocks.set(a, t);
  }

  // 2. First step on the path to a goal course.
  const stepping = courses.filter((c) => eligible(c) && unlocks.has(c.id));
  if (stepping.length) {
    const c = stepping[0];
    const target = unlocks.get(c.id)!;
    return {
      kind: "enroll",
      courseId: c.id,
      title: c.title,
      reason: `First step toward ${target.title}, which teaches ${listJoin(goalsTaught(target))}, your goal.`,
    };
  }

  // 3. Resume something already started.
  const inProgress = learner.enrollments
    .map((e) => ({ e, c: catalog.get(e.courseId)! }))
    .filter(({ e, c }) => c && !isComplete(e.completedLessons, c.totalLessons))
    .filter(({ c }) => goalsTaught(c).length > 0 || unlocks.has(c.id))
    .map(({ e, c }) => ({
      e,
      c,
      actionable: missingPrerequisites(c.id, learner, catalog).length === 0,
      blocks: unlocks.has(c.id),
      percent: percentComplete(e.completedLessons, c.totalLessons),
    }))
    .sort(
      (x, y) =>
        Number(y.actionable) - Number(x.actionable) ||
        Number(y.blocks) - Number(x.blocks) ||
        y.percent - x.percent ||
        x.c.id.localeCompare(y.c.id),
    );
  if (inProgress.length) {
    const { e, c, percent } = inProgress[0];
    const goals = goalsTaught(c);
    const lead = percent === 0 ? `Start ${c.title} (enrolled, no lessons done yet)` : `Keep going with ${c.title} (${percent}% done)`;
    let reason =
      goals.length > 0
        ? `${lead}. It teaches ${listJoin(goals)}, ${goals.length > 1 ? "your goals" : "your goal"}.`
        : `Finish ${c.title} (${percent}% done). It unlocks ${unlocks.get(c.id)!.title}, which teaches ${listJoin(
            goalsTaught(unlocks.get(c.id)!),
          )}.`;
    const last = lastActive(e, asOf);
    const idle = Math.max(0, daysBetween(localDay(last.at, learner.timezone), localDay(asOf, learner.timezone)));
    if (idle > AT_RISK_AFTER_DAYS) reason += ` No activity for ${idle} days.`;
    return { kind: "resume", courseId: c.id, title: c.title, reason };
  }

  return { kind: "none", reason: "No eligible course teaches your remaining goals at this center yet." };
}

// ---------------------------------------------------------------------------
// Everything the dashboard shows for one learner.
// ---------------------------------------------------------------------------

export function buildLearnerView(learner: LearnerRecord, catalog: Catalog, asOf: Date): LearnerView {
  const today = localDay(asOf, learner.timezone);
  const earned = earnedSkills(learner, catalog);

  const courses: CourseView[] = learner.enrollments
    .filter((e) => catalog.has(e.courseId))
    .map((e) => {
      const c = catalog.get(e.courseId)!;
      const last = lastActive(e, asOf);
      const daysInactive = Math.max(0, daysBetween(localDay(last.at, learner.timezone), today));
      return {
        enrollmentId: e.enrollmentId,
        courseId: c.id,
        title: c.title,
        skills: c.skills,
        completedLessons: e.completedLessons,
        totalLessons: c.totalLessons,
        percent: percentComplete(e.completedLessons, c.totalLessons),
        status: courseStatus(e.completedLessons, c.totalLessons, daysInactive),
        lastActiveAt: last.at,
        lastActiveIsEnrollment: last.fromEnrollment,
        daysInactive,
        missingPrerequisites: missingPrerequisites(c.id, learner, catalog).map((p) => catalog.get(p)?.title ?? p),
        lastNudgedAt: e.lastNudgedAt,
      };
    });

  const rank: Record<CourseStatus, number> = { "at-risk": 0, "on-track": 1, completed: 2 };
  courses.sort((a, b) => rank[a.status] - rank[b.status] || b.daysInactive - a.daysInactive);

  const open = courses.filter((c) => c.status !== "completed");
  const status: LearnerStatus =
    courses.length === 0
      ? "no-courses"
      : open.some((c) => c.status === "at-risk")
        ? "at-risk"
        : open.length > 0
          ? "on-track"
          : "completed";

  return {
    id: learner.id,
    name: learner.name,
    centerName: learner.centerName,
    timezone: learner.timezone,
    goals: learner.goals.map((g) => ({ skill: g, earned: earned.has(g) })),
    earnedSkills: [...earned].map(([skill, fromCourse]) => ({ skill, fromCourse })).sort((a, b) => a.skill.localeCompare(b.skill)),
    activeDays: activeDays(learner, asOf),
    courses,
    recommendation: recommend(learner, catalog, asOf),
    status,
    maxDaysInactive: open.length ? Math.max(...open.map((c) => c.daysInactive)) : null,
  };
}

const statusRank: Record<LearnerStatus, number> = { "at-risk": 0, "no-courses": 1, "on-track": 2, completed: 3 };

/** Coach triage order: at-risk first (longest idle first), then not started, on track, done. */
export function compareForTriage(a: LearnerView, b: LearnerView): number {
  return (
    statusRank[a.status] - statusRank[b.status] ||
    (b.maxDaysInactive ?? -1) - (a.maxDaysInactive ?? -1) ||
    a.name.localeCompare(b.name)
  );
}
