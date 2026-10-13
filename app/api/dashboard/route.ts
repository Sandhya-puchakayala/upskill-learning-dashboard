import type { NextRequest } from "next/server";
import { clockFrom, handle, requireCoach } from "@/lib/api";
import { loadCatalog, loadLearnersInCenter } from "@/lib/queries";
import { buildLearnerView, compareForTriage } from "@/lib/rules";

export const dynamic = "force-dynamic";

/** Every learner in the coach's center, in triage order. */
export function GET(req: NextRequest) {
  return handle(async () => {
    const params = req.nextUrl.searchParams;
    const coach = await requireCoach(params.get("coachId"));
    const { mode, asOf } = clockFrom(params.get("clock"));
    const [learners, catalog] = await Promise.all([loadLearnersInCenter(coach.centerId), loadCatalog()]);
    const views = learners.map((l) => buildLearnerView(l, catalog, asOf)).sort(compareForTriage);
    return { coach, clock: mode, asOf: asOf.toISOString(), learners: views };
  });
}
