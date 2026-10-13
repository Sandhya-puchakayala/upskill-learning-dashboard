import { NextResponse } from "next/server";
import { getCoach, loadCatalog, loadLearnersInCenter, type Coach } from "./queries";
import { buildLearnerView, type LearnerRecord } from "./rules";

/**
 * The seed data was captured around this moment; with the real clock every
 * learner is weeks idle. The UI defaults to it and can switch to "today".
 */
export const SEED_CLOCK = "2026-10-06T12:00:00+05:30";

export type ClockMode = "seed" | "today";

export function clockFrom(mode: unknown): { mode: ClockMode; asOf: Date } {
  return mode === "seed" ? { mode, asOf: new Date(SEED_CLOCK) } : { mode: "today", asOf: new Date() };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handle(fn: () => Promise<unknown>) {
  return fn()
    .then((body) => NextResponse.json(body))
    .catch((err: unknown) => {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error(err);
      return NextResponse.json({ error: "Something went wrong on the server." }, { status: 500 });
    });
}

export async function requireCoach(coachId: unknown): Promise<Coach> {
  if (typeof coachId !== "string" || !coachId) throw new HttpError(400, "coachId is required.");
  const coach = await getCoach(coachId);
  if (!coach) throw new HttpError(404, "Coach not found.");
  return coach;
}

/** A learner the coach may see, i.e. currently in the coach's center. */
export async function requireLearner(coach: Coach, learnerId: unknown): Promise<LearnerRecord> {
  if (typeof learnerId !== "string" || !learnerId) throw new HttpError(400, "learnerId is required.");
  const [learner] = await loadLearnersInCenter(coach.centerId, learnerId);
  if (!learner) throw new HttpError(404, "Learner not found in your center.");
  return learner;
}

export async function learnerView(coach: Coach, learnerId: string, asOf: Date) {
  const [learner, catalog] = await Promise.all([requireLearner(coach, learnerId), loadCatalog()]);
  return buildLearnerView(learner, catalog, asOf);
}
