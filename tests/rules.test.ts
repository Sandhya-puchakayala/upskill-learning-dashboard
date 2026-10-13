import { describe, expect, it } from "vitest";
import courses from "../seed/courses.json";
import {
  activeDays,
  buildLearnerView,
  checkEligibility,
  compareForTriage,
  courseStatus,
  earnsSkills,
  percentComplete,
  recommend,
  type Catalog,
  type EnrollmentRecord,
  type LearnerRecord,
} from "../lib/rules";

const lessons: Record<string, number> = { c1: 12, c2: 12, c3: 16, c4: 10, c5: 12, c6: 10 };
const catalog: Catalog = new Map(
  courses.map((c) => [
    c.id,
    { id: c.id, title: c.title, totalLessons: lessons[c.id], skills: c.skillsTaught, prerequisites: c.prerequisites },
  ]),
);

const SEED_CLOCK = new Date("2026-10-06T12:00:00+05:30");
const TZ = "Asia/Kolkata";
let nextId = 1;

function enrollment(courseId: string, completedLessons: number, activity: string[] = [], enrolledAt = "2026-09-01T09:00:00+05:30"): EnrollmentRecord {
  return { enrollmentId: nextId++, courseId, enrolledAt, completedLessons, activity, lastNudgedAt: null };
}

function learner(goals: string[], enrollments: EnrollmentRecord[], offered = [...catalog.keys()]): LearnerRecord {
  return { id: "x", name: "X", centerId: "ctr", centerName: "Center", timezone: TZ, goals, offeredCourseIds: offered, enrollments };
}

// The provided seed, as records.
const aisha = learner(["react", "frontend"], [
  enrollment("c1", 12, ["2026-09-14T18:00:00+05:30"]),
  enrollment("c2", 10, ["2026-10-04T20:15:00+05:30"]),
  enrollment("c3", 4, ["2026-10-05T12:00:00+05:30"]),
]);
const rohan = learner(["sql", "dashboards"], [
  enrollment("c4", 10, ["2026-08-30T17:00:00+05:30"]),
  enrollment("c5", 3, ["2026-09-28T16:40:00+05:30"]),
]);
const priya = learner(["product", "user-research"], [enrollment("c6", 5, ["2026-10-03T21:10:00+05:30"])]);

describe("percent and thresholds", () => {
  it("rounds percent down", () => {
    expect(percentComplete(10, 12)).toBe(83);
    expect(percentComplete(11, 12)).toBe(91);
    expect(percentComplete(12, 12)).toBe(100);
  });

  it("earns skills at exactly 80%, not below", () => {
    expect(earnsSkills(8, 10)).toBe(true);
    expect(earnsSkills(7, 10)).toBe(false);
    expect(earnsSkills(4, 5)).toBe(true);
    expect(earnsSkills(12, 15)).toBe(true); // 0.8 exactly; float math would be fragile here
  });
});

describe("at-risk", () => {
  it("is on track at exactly 3 days and at risk after", () => {
    expect(courseStatus(1, 10, 3)).toBe("on-track");
    expect(courseStatus(1, 10, 4)).toBe("at-risk");
  });

  it("never marks a completed course at risk", () => {
    expect(courseStatus(10, 10, 60)).toBe("completed");
  });

  it("matches the seed on the seed clock", () => {
    const status = (l: LearnerRecord) =>
      Object.fromEntries(buildLearnerView(l, catalog, SEED_CLOCK).courses.map((c) => [c.courseId, [c.status, c.daysInactive]]));
    expect(status(aisha)).toEqual({ c1: ["completed", 22], c2: ["on-track", 2], c3: ["on-track", 1] });
    expect(status(rohan)).toEqual({ c4: ["completed", 37], c5: ["at-risk", 8] });
    expect(status(priya)).toEqual({ c6: ["on-track", 3] }); // boundary case in the seed
  });

  it("counts calendar days in the center timezone, not UTC", () => {
    // 23:30 IST on Oct 2 is still Oct 2 in IST (18:00 UTC). Oct 6 is 4 days later.
    const l = learner([], [enrollment("c6", 1, ["2026-10-02T23:30:00+05:30"])]);
    expect(buildLearnerView(l, catalog, SEED_CLOCK).courses[0]).toMatchObject({ daysInactive: 4, status: "at-risk" });
  });

  it("counts a never-started course from its enrollment date", () => {
    const l = learner([], [enrollment("c6", 0, [], "2026-10-01T09:00:00+05:30")]);
    expect(buildLearnerView(l, catalog, SEED_CLOCK).courses[0]).toMatchObject({ daysInactive: 5, status: "at-risk", lastActiveIsEnrollment: true });
  });
});

describe("earned skills and goals", () => {
  it("earns skills from 80%+ courses only", () => {
    const view = buildLearnerView(aisha, catalog, SEED_CLOCK);
    expect(view.earnedSkills.map((s) => s.skill)).toEqual(["css", "frontend", "html", "javascript"]);
    expect(view.goals).toEqual([
      { skill: "react", earned: false },
      { skill: "frontend", earned: true },
    ]);
  });

  it("shows no skills for a 50% course", () => {
    expect(buildLearnerView(priya, catalog, SEED_CLOCK).earnedSkills).toEqual([]);
  });
});

describe("active days", () => {
  it("counts distinct days in the 7 days ending on asOf", () => {
    expect(activeDays(aisha, SEED_CLOCK).count).toBe(2); // Oct 4, Oct 5
    expect(activeDays(rohan, SEED_CLOCK).count).toBe(0); // Sep 28 is outside Sep 30..Oct 6
    expect(activeDays(priya, SEED_CLOCK).count).toBe(1);
  });

  it("counts two sessions on the same day once and ignores the future", () => {
    const l = learner([], [
      enrollment("c1", 1, ["2026-10-05T09:00:00+05:30", "2026-10-05T21:00:00+05:30"]),
      enrollment("c4", 1, ["2026-10-05T10:00:00+05:30", "2026-10-08T10:00:00+05:30"]),
    ]);
    const result = activeDays(l, SEED_CLOCK);
    expect(result.count).toBe(1);
    expect(result.days).toHaveLength(7);
    expect(result.days[6]).toEqual({ date: "2026-10-06", active: false });
  });
});

describe("eligibility", () => {
  it("requires every prerequisite at 100%, not 80%", () => {
    // Aisha has c2 at 83%: enough for skills, not enough to unlock c3.
    const l = learner([], [enrollment("c1", 12), enrollment("c2", 10)]);
    expect(checkEligibility("c3", l, catalog)).toEqual({ eligible: false, reason: "missing-prerequisites", missing: ["c2"] });
    l.enrollments[1].completedLessons = 12;
    expect(checkEligibility("c3", l, catalog)).toEqual({ eligible: true });
  });

  it("rejects duplicates, unknown courses and courses the center doesn't offer", () => {
    expect(checkEligibility("c1", aisha, catalog)).toMatchObject({ reason: "already-enrolled" });
    expect(checkEligibility("nope", aisha, catalog)).toMatchObject({ reason: "unknown-course" });
    expect(checkEligibility("c6", learner([], [], ["c1"]), catalog)).toMatchObject({ reason: "not-offered" });
  });

  it("flags an enrolled course whose prerequisite is not finished", () => {
    const c3 = buildLearnerView(aisha, catalog, SEED_CLOCK).courses.find((c) => c.courseId === "c3")!;
    expect(c3.missingPrerequisites).toEqual(["JavaScript Essentials"]);
  });
});

describe("recommend next", () => {
  it("enrolls in an eligible course that teaches a goal", () => {
    const r = recommend(learner(["data", "dashboards"], []), catalog, SEED_CLOCK);
    expect(r).toMatchObject({ kind: "enroll", courseId: "c4" }); // c5 teaches dashboards but needs c4
  });

  it("prefers the course covering more goals", () => {
    const r = recommend(learner(["sql", "dashboards"], [enrollment("c4", 10)]), catalog, SEED_CLOCK);
    expect(r).toMatchObject({ kind: "enroll", courseId: "c5" });
  });

  it("suggests the first step toward a goal course that is locked", () => {
    const r = recommend(learner(["react"], []), catalog, SEED_CLOCK);
    expect(r).toMatchObject({ kind: "enroll", courseId: "c1" });
    expect(r.reason).toContain("React Basics");
  });

  it("asks Aisha to finish the prerequisite that blocks her goal", () => {
    const r = recommend(aisha, catalog, SEED_CLOCK);
    expect(r).toMatchObject({ kind: "resume", courseId: "c2" });
    expect(r.reason).toContain("unlocks React Basics");
  });

  it("asks Rohan to resume his at-risk goal course", () => {
    const r = recommend(rohan, catalog, SEED_CLOCK);
    expect(r).toMatchObject({ kind: "resume", courseId: "c5" });
    expect(r.reason).toContain("No activity for 8 days");
  });

  it("never recommends an ineligible or already-enrolled course to enroll in", () => {
    for (const l of [aisha, rohan, priya]) {
      const r = recommend(l, catalog, SEED_CLOCK);
      if (r.kind === "enroll") expect(checkEligibility(r.courseId, l, catalog).eligible).toBe(true);
    }
  });

  it("says so when goals are met or missing", () => {
    expect(recommend(learner(["sql"], [enrollment("c4", 10)]), catalog, SEED_CLOCK)).toMatchObject({ kind: "none" });
    expect(recommend(learner([], []), catalog, SEED_CLOCK)).toMatchObject({ kind: "none" });
  });

  it("says so when no course at the center can help", () => {
    expect(recommend(learner(["product"], [], ["c1", "c2"]), catalog, SEED_CLOCK)).toMatchObject({ kind: "none" });
  });
});

describe("triage order", () => {
  it("puts at-risk learners first, then not started, then on track", () => {
    const fresh = { ...learner(["data"], []), name: "New" };
    const views = [aisha, rohan, priya, fresh].map((l) => buildLearnerView(l, catalog, SEED_CLOCK));
    views[0].name = "Aisha";
    views[1].name = "Rohan";
    views[2].name = "Priya";
    expect(views.sort(compareForTriage).map((v) => [v.name, v.status])).toEqual([
      ["Rohan", "at-risk"],
      ["New", "no-courses"],
      ["Priya", "on-track"],
      ["Aisha", "on-track"],
    ]);
  });
});
