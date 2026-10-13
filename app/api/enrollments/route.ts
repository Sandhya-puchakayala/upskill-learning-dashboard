import { clockFrom, handle, HttpError, learnerView, requireCoach, requireLearner } from "@/lib/api";
import { insertEnrollment, loadCatalog } from "@/lib/queries";
import { checkEligibility } from "@/lib/rules";

export const dynamic = "force-dynamic";

const messages = {
  "unknown-course": [404, "Course not found."],
  "already-enrolled": [409, "Already enrolled in this course."],
  "not-offered": [422, "This course is not offered at the learner's center."],
  "missing-prerequisites": [422, "Prerequisites are not complete yet."],
} as const;

/** Enroll a learner. Eligibility is re-checked here; the UI is not trusted. */
export function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    const coach = await requireCoach(body.coachId);
    const learner = await requireLearner(coach, body.learnerId);
    const { asOf } = clockFrom(body.clock);

    const check = checkEligibility(String(body.courseId ?? ""), learner, await loadCatalog());
    if (!check.eligible) {
      const [status, message] = messages[check.reason];
      throw new HttpError(status, message);
    }
    try {
      await insertEnrollment(learner.id, body.courseId, learner.centerId, asOf);
    } catch (err) {
      // Lost a race with a second click / second tab.
      if (String(err).includes("UNIQUE")) throw new HttpError(409, messages["already-enrolled"][1]);
      throw err;
    }
    return { learner: await learnerView(coach, learner.id, asOf) };
  });
}

