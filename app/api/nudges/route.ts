import { clockFrom, handle, HttpError, learnerView, requireCoach, requireLearner } from "@/lib/api";
import { insertNudge } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Log that the coach reached out about one of the learner's courses. */
export function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    const coach = await requireCoach(body.coachId);
    const learner = await requireLearner(coach, body.learnerId);
    const { asOf } = clockFrom(body.clock);

    const enrollment = learner.enrollments.find((e) => e.enrollmentId === Number(body.enrollmentId));
    if (!enrollment) throw new HttpError(404, "Enrollment not found for this learner.");

    await insertNudge(coach.id, enrollment.enrollmentId, asOf);
    return { learner: await learnerView(coach, learner.id, asOf) };
  });
}
