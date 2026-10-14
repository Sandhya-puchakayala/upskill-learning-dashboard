"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Lock,
  Menu,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  TriangleAlert,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Coach } from "@/lib/queries";
import {
  averageProgress,
  compareByPerformance,
  compareForTriage,
  type CourseView, type LearnerStatus, type LearnerView } from "@/lib/rules";

type Clock = "seed" | "today";
type Filter = "all" | LearnerStatus;
type Dashboard =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; learners: LearnerView[]; asOf: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status}).`);
  return body as T;
}

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: preference just isn't remembered */
    }
  },
};

const formatDay = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric", timeZone });

const formatLongDay = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone });

const dayParts = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
    narrow: d.toLocaleDateString("en-IN", { weekday: "narrow", timeZone: "UTC" }),
    date: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
    num: d.getUTCDate(),
  };
};

const ago = (days: number) => (days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const STATUS_LABEL: Record<LearnerStatus, string> = {
  "at-risk": "At risk",
  "no-courses": "Not started",
  "on-track": "On track",
  completed: "Completed",
};
const STATUS_ICON: Record<LearnerStatus, LucideIcon> = {
  "at-risk": TriangleAlert,
  "no-courses": Clock,
  "on-track": CircleCheck,
  completed: GraduationCap,
};
const STATUS_ORDER: LearnerStatus[] = ["at-risk", "no-courses", "on-track", "completed"];

/** The most recent activity across all of a learner's courses. */
function lastSeen(l: LearnerView): { at: string; days: number } | null {
  const real = l.courses.filter((c) => !c.lastActiveIsEnrollment);
  if (!real.length) return null;
  const latest = real.reduce((a, b) => (a.daysInactive <= b.daysInactive ? a : b));
  return { at: latest.lastActiveAt, days: latest.daysInactive };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar avatar-${size}`} style={{ "--h": hue(name) } as React.CSSProperties} aria-hidden>
      {initials(name)}
    </span>
  );
}

function StatusBadge({ status }: { status: LearnerStatus | CourseView["status"] }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`badge ${status}`}>
      <Icon size={12} strokeWidth={2.5} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function GoalRing({ earned, total }: { earned: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = total ? earned / total : 0;
  return (
    <svg className="ring" viewBox="0 0 64 64" width="64" height="64" aria-hidden>
      <circle cx="32" cy="32" r={r} className="ring-track" />
      <circle
        cx="32"
        cy="32"
        r={r}
        className="ring-value"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="36" textAnchor="middle" className="ring-text">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** Columns: how many learners were active on each of the last 7 days. */
function ActivityChart({ learners }: { learners: LearnerView[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = learners[0]?.activeDays.days ?? [];
  const data = days.map((d, i) => {
    const who = learners.filter((l) => l.activeDays.days[i]?.active).map((l) => l.name);
    return { ...d, ...dayParts(d.date), count: who.length, who };
  });
  const max = Math.max(2, ...data.map((d) => d.count));
  const ticks = Array.from({ length: max + 1 }, (_, i) => i).filter((t) => max <= 4 || t % Math.ceil(max / 4) === 0);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="chart">
      <div className="plot" role="img" aria-label={`Learners active per day, last 7 days. ${data.map((d) => `${d.weekday} ${d.date}: ${d.count}`).join(", ")}.`}>
        <div className="y-axis" aria-hidden>
          {ticks
            .slice()
            .reverse()
            .map((t) => (
              <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
                {t}
              </span>
            ))}
        </div>
        <div className="plot-area">
          {ticks.map((t) => (
            <i key={t} className="gridline" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden />
          ))}
          {data.map((d, i) => (
            <div
              key={d.date}
              className="col"
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${d.weekday} ${d.date}: ${plural(d.count, "learner")} active`}
            >
              <div className={`bar-col ${hover === i ? "is-hover" : ""}`} style={{ height: `${(d.count / max) * 100}%` }}>
                {d.count > 0 && <span className="cap">{d.count}</span>}
              </div>
              {hover === i && (
                <div className="tooltip" role="tooltip">
                  <strong>
                    {d.weekday}, {d.date}
                  </strong>
                  <span>{plural(d.count, "learner")} active</span>
                  {d.who.length > 0 && <em>{d.who.join(", ")}</em>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="x-axis" aria-hidden>
        {data.map((d) => (
          <span key={d.date}>
            <b>{d.narrow}</b>
            <span className="x-full">{d.date}</span>
            <span className="x-num">{d.num}</span>
          </span>
        ))}
      </div>
      <p className="chart-foot">
        {plural(total, "learner-day")} of activity this week across {plural(learners.length, "learner")}.
      </p>
    </div>
  );
}

/** One segmented bar: share of learners in each status. */
function StatusChart({ learners, onPick }: { learners: LearnerView[]; onPick: (f: Filter) => void }) {
  const [hover, setHover] = useState<LearnerStatus | null>(null);
  const rows = STATUS_ORDER.map((s) => ({ status: s, count: learners.filter((l) => l.status === s).length })).filter(
    (r) => r.count > 0 || r.status !== "completed",
  );
  const total = learners.length || 1;

  return (
    <div className="chart">
      <div className="stack" role="img" aria-label={rows.map((r) => `${STATUS_LABEL[r.status]}: ${r.count}`).join(", ")}>
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <div
              key={r.status}
              className={`seg ${r.status} ${hover && hover !== r.status ? "dim" : ""}`}
              style={{ flexGrow: r.count }}
              onMouseEnter={() => setHover(r.status)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === r.status && (
                <div className="tooltip" role="tooltip">
                  <strong>{STATUS_LABEL[r.status]}</strong>
                  <span>
                    {plural(r.count, "learner")} · {Math.round((r.count / total) * 100)}%
                  </span>
                </div>
              )}
            </div>
          ))}
      </div>
      <ul className="legend">
        {rows.map((r) => {
          const Icon = STATUS_ICON[r.status];
          return (
            <li key={r.status}>
              <button
                className="legend-row"
                onMouseEnter={() => setHover(r.status)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick(r.status)}
              >
                <span className={`swatch ${r.status}`}>
                  <Icon size={12} strokeWidth={2.5} />
                </span>
                <span className="legend-label">{STATUS_LABEL[r.status]}</span>
                <span className="legend-value">{r.count}</span>
                <span className="legend-pct">{Math.round((r.count / total) * 100)}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Page() {
  const [coaches, setCoaches] = useState<Coach[] | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachId, setCoachId] = useState("");
  const [clock, setClock] = useState<Clock>("seed");
  const [dash, setDash] = useState<Dashboard>({ state: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"performance" | "urgent">("performance");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Coaches (stands in for "who is logged in").
  useEffect(() => {
    api<{ coaches: Coach[] }>("/api/coaches")
      .then(({ coaches }) => {
        setCoaches(coaches);
        const saved = store.get("upskill.coach");
        setCoachId(coaches.find((c) => c.id === saved)?.id ?? coaches[0]?.id ?? "");
        if (store.get("upskill.clock") === "today") setClock("today");
      })
      .catch((e: Error) => setCoachError(e.message));
  }, [reload]);

  // Dashboard for the coach's center.
  useEffect(() => {
    if (!coachId) return;
    let live = true;
    setDash({ state: "loading" });
    api<{ learners: LearnerView[]; asOf: string }>(`/api/dashboard?coachId=${encodeURIComponent(coachId)}&clock=${clock}`)
      .then(({ learners, asOf }) => {
        if (!live) return;
        setDash({ state: "ready", learners, asOf });
        setOpenId((cur) => (learners.some((l) => l.id === cur) ? cur : null));
      })
      .catch((e: Error) => live && setDash({ state: "error", message: e.message }));
    return () => {
      live = false;
    };
  }, [coachId, clock, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Esc closes the drawer / menu; lock page scroll while the drawer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenId(null);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = openId || menuOpen ? "hidden" : "";
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, menuOpen]);

  const learners = dash.state === "ready" ? dash.learners : [];
  const open = learners.find((l) => l.id === openId) ?? null;
  const coach = coaches?.find((c) => c.id === coachId);
  const visible = (filter === "all" ? learners : learners.filter((l) => l.status === filter))
    .slice()
    .sort(sort === "performance" ? compareByPerformance : compareForTriage);
  const tz = learners[0]?.timezone ?? "Asia/Kolkata";

  const replaceLearner = useCallback((updated: LearnerView) => {
    setDash((d) =>
      d.state === "ready"
        ? { ...d, learners: d.learners.map((l) => (l.id === updated.id ? updated : l)).sort(compareForTriage) }
        : d,
    );
  }, []);

  const enroll = useCallback(
    async (learner: LearnerView, courseId: string, title: string) => {
      const res = await api<{ learner: LearnerView }>("/api/enrollments", {
        method: "POST",
        body: JSON.stringify({ coachId, learnerId: learner.id, courseId, clock }),
      });
      replaceLearner(res.learner);
      setToast(`Enrolled ${learner.name} in ${title}.`);
    },
    [coachId, clock, replaceLearner],
  );

  const nudge = useCallback(
    async (learner: LearnerView, course: CourseView) => {
      const res = await api<{ learner: LearnerView }>("/api/nudges", {
        method: "POST",
        body: JSON.stringify({ coachId, learnerId: learner.id, enrollmentId: course.enrollmentId, clock }),
      });
      replaceLearner(res.learner);
      setToast(`Logged a nudge to ${learner.name} about ${course.title}.`);
    },
    [coachId, clock, replaceLearner],
  );

  const pickFilter = (f: Filter) => {
    setFilter(f);
    setMenuOpen(false);
    document.getElementById("learners")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const counts = useMemo(() => {
    const by = (s: LearnerStatus) => learners.filter((l) => l.status === s).length;
    const enrollments = learners.reduce((n, l) => n + l.courses.length, 0);
    const avgActive = learners.length ? learners.reduce((n, l) => n + l.activeDays.count, 0) / learners.length : 0;
    return {
      total: learners.length,
      "at-risk": by("at-risk"),
      "no-courses": by("no-courses"),
      "on-track": by("on-track"),
      completed: by("completed"),
      enrollments,
      avgActive,
    };
  }, [learners]);

  const nav: { key: Filter; label: string; icon: LucideIcon }[] = [
    { key: "all", label: "Overview", icon: LayoutDashboard },
    { key: "at-risk", label: "At risk", icon: TriangleAlert },
    { key: "no-courses", label: "Not started", icon: Clock },
    { key: "on-track", label: "On track", icon: CircleCheck },
    ...(counts.completed ? [{ key: "completed" as const, label: "Completed", icon: GraduationCap }] : []),
  ];

  const ready = dash.state === "ready" && learners.length > 0;

  return (
    <div className="shell">
      {/* ---------------- Sidebar ---------------- */}
      <div className={`scrim ${menuOpen ? "show" : ""}`} onClick={() => setMenuOpen(false)} aria-hidden />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Main">
        <div className="side-brand">
          <span className="logo" aria-hidden>
            <Sparkles size={17} strokeWidth={2.5} />
          </span>
          <span className="brand-name">Upskill</span>
          <button className="icon-btn side-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="side-nav">
          <p className="side-label">Learners</p>
          {nav.map((n) => (
            <button
              key={n.key}
              className={`side-item ${filter === n.key ? "active" : ""} ${n.key}`}
              aria-current={filter === n.key ? "page" : undefined}
              onClick={() => pickFilter(n.key)}
              disabled={!ready}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {ready && <span className="side-count">{n.key === "all" ? counts.total : counts[n.key]}</span>}
            </button>
          ))}
        </nav>

        <div className="side-bottom">
          {coach && (
            <div className="center-card">
              <span className="center-icon">
                <Building2 size={16} />
              </span>
              <div>
                <p className="center-name">{coach.centerName} center</p>
                <p className="center-sub">You see only this center</p>
              </div>
            </div>
          )}
          {coaches && coaches.length > 0 && (
            <label className="coach-switch">
              <span className="side-label">Signed in as</span>
              <span className="coach-select">
                {coach && <Avatar name={coach.name} size="sm" />}
                <select
                  value={coachId}
                  onChange={(e) => {
                    setCoachId(e.target.value);
                    store.set("upskill.coach", e.target.value);
                    setFilter("all");
                    setOpenId(null);
                    setMenuOpen(false);
                  }}
                >
                  {coaches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.centerName}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <h1>Coach dashboard</h1>
            <p>
              <CalendarDays size={13} />
              {dash.state === "ready" ? formatLongDay(dash.asOf, tz) : "Loading…"}
            </p>
          </div>
          <div className="topbar-actions">
            <div className="segmented" role="group" aria-label="As of">
              {(["seed", "today"] as const).map((c) => (
                <button
                  key={c}
                  aria-pressed={clock === c}
                  onClick={() => {
                    setClock(c);
                    store.set("upskill.clock", c);
                  }}
                  title={c === "seed" ? "The date the seed data was captured" : "The real current date"}
                >
                  {c === "seed" ? "Oct 6 · seed" : "Today"}
                </button>
              ))}
            </div>
            {coach && (
              <span className="coach-chip">
                <Avatar name={coach.name} size="sm" />
                <span className="coach-chip-text">
                  <b>{coach.name}</b>
                  <small>{coach.centerName}</small>
                </span>
              </span>
            )}
          </div>
        </header>

        <main className={`content ${filter !== "all" ? "filtered" : ""}`}>
          {coachError ? (
            <ErrorState message={coachError} onRetry={() => (setCoachError(null), setReload((n) => n + 1))} />
          ) : coaches && coaches.length === 0 ? (
            <EmptyState title="No coaches yet" text="Run npm run db:reset to load the seed data." />
          ) : dash.state === "error" ? (
            <ErrorState message={dash.message} onRetry={() => setReload((n) => n + 1)} />
          ) : dash.state === "loading" ? (
            <LoadingState />
          ) : learners.length === 0 ? (
            <EmptyState
              title={`No learners in ${coach?.centerName ?? "this center"} yet`}
              text="Learners appear here once they join this center."
            />
          ) : (
            <>
              {/* Stat strip */}
              <section className="strip" aria-label="Center summary">
                <div className="strip-cell welcome">
                  <span className="strip-label">Welcome</span>
                  <span className="strip-name">{coach?.name}</span>
                </div>
                {(
                  [
                    { label: "Total learners", value: counts.total, f: "all" },
                    { label: "At risk", value: counts["at-risk"], f: "at-risk", tone: "risk" },
                    { label: "Not started", value: counts["no-courses"], f: "no-courses", tone: "idle" },
                    { label: "On track", value: counts["on-track"], f: "on-track", tone: "ok" },
                    { label: "Enrollments", value: counts.enrollments },
                    { label: "Avg active days", value: counts.avgActive.toFixed(1) },
                  ] as { label: string; value: number | string; f?: Filter; tone?: string }[]
                ).map((s) =>
                  s.f ? (
                    <button
                      key={s.label}
                      className={`strip-cell ${s.tone ? `tone-${s.tone}` : ""} ${filter === s.f && s.f !== "all" ? "active" : ""}`}
                      onClick={() => pickFilter(s.f!)}
                    >
                      <span className="strip-label">
                        {s.tone && <i className="strip-dot" />}
                        {s.label}
                      </span>
                      <span className="strip-value">{s.value}</span>
                    </button>
                  ) : (
                    <div key={s.label} className="strip-cell">
                      <span className="strip-label">{s.label}</span>
                      <span className="strip-value">{s.value}</span>
                    </div>
                  ),
                )}
              </section>

              {/* Charts */}
              <section className="card charts">
                <div className="chart-panel">
                  <div className="chart-head">
                    <div>
                      <h2>Daily active learners</h2>
                      <p>Learners with any activity, last 7 days</p>
                    </div>
                    <span className="chart-chip">
                      <Activity size={13} /> 7 days
                    </span>
                  </div>
                  <ActivityChart learners={learners} />
                </div>
                <div className="chart-divider" aria-hidden />
                <div className="chart-panel">
                  <div className="chart-head">
                    <div>
                      <h2>Learner status</h2>
                      <p>At risk = an unfinished course idle more than 3 days</p>
                    </div>
                  </div>
                  <StatusChart learners={learners} onPick={pickFilter} />
                </div>
              </section>

              {/* Learner table */}
              <section className="card table-card" id="learners">
                <div className="table-head">
                  <div>
                    <h2>{filter === "all" ? "Learners" : STATUS_LABEL[filter]}</h2>
                    <p>
                      {sort === "performance" ? "Top performers first: goals reached, then average progress" : "Most urgent first: at risk, then not started"}{" "}
                      · click a learner for details
                    </p>
                  </div>
                  <div className="table-tools">
                    <div className="segmented" role="group" aria-label="Sort learners">
                      <button aria-pressed={sort === "performance"} onClick={() => setSort("performance")}>
                        Top performers
                      </button>
                      <button aria-pressed={sort === "urgent"} onClick={() => setSort("urgent")}>
                        Most urgent
                      </button>
                    </div>
                    <div className="filter-chips" role="group" aria-label="Filter learners">
                      {nav.map((n) => (
                        <button key={n.key} aria-pressed={filter === n.key} onClick={() => setFilter(n.key)}>
                          {n.key === "all" ? "All" : n.label}
                          <span>{n.key === "all" ? counts.total : counts[n.key]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {visible.length === 0 ? (
                  <div className="table-empty">
                    <Inbox size={18} /> No learners match this filter.
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th><span className="th-pill"><UserRound size={13} />Learner</span></th>
                          <th><span className="th-pill"><Activity size={13} />Status</span></th>
                          <th><span className="th-pill"><Clock size={13} />Last active</span></th>
                          <th><span className="th-pill"><CalendarDays size={13} />Active · 7d</span></th>
                          <th><span className="th-pill"><Target size={13} />Goals</span></th>
                          <th><span className="th-pill"><Sparkles size={13} />Next step</span></th>
                          <th aria-label="Open" />
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((l) => {
                          const earned = l.goals.filter((g) => g.earned).length;
                          const seen = lastSeen(l);
                          const reco = l.recommendation;
                          return (
                            <tr
                              key={l.id}
                              tabIndex={0}
                              className={l.id === openId ? "selected" : ""}
                              onClick={() => setOpenId(l.id)}
                              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(l.id))}
                              aria-label={`Open ${l.name}`}
                            >
                              <td data-label="Learner">
                                <span className="cell-learner">
                                  <Avatar name={l.name} />
                                  <span>
                                    <b>{l.name}</b>
                                    <small>
                                      {plural(l.courses.length, "course")}
                                      {l.courses.length > 0 && ` · ${averageProgress(l)}% avg`}
                                    </small>
                                  </span>
                                </span>
                              </td>
                              <td data-label="Status">
                                <StatusBadge status={l.status} />
                              </td>
                              <td data-label="Last active">
                                {seen ? (
                                  <span className="cell-stack">
                                    <b className={l.status === "at-risk" ? "risk-text" : ""}>{ago(seen.days)}</b>
                                    <small>{formatDay(seen.at, l.timezone)}</small>
                                  </span>
                                ) : (
                                  <span className="muted">No activity yet</span>
                                )}
                              </td>
                              <td data-label="Active · 7d">
                                <span className="cell-week" aria-label={`${l.activeDays.count} of 7 days`}>
                                  {l.activeDays.days.map((d) => (
                                    <i key={d.date} className={d.active ? "on" : ""} />
                                  ))}
                                  <b>{l.activeDays.count}/7</b>
                                </span>
                              </td>
                              <td data-label="Goals">
                                <span className="cell-goals">
                                  <span className="goal-track">
                                    <span style={{ width: `${l.goals.length ? (earned / l.goals.length) * 100 : 0}%` }} />
                                  </span>
                                  <b>
                                    {earned}/{l.goals.length}
                                  </b>
                                </span>
                              </td>
                              <td data-label="Next step">
                                {reco.kind === "none" ? (
                                  <span className="muted">—</span>
                                ) : (
                                  <span className="cell-next">
                                    <span className={`next-tag ${reco.kind}`}>{reco.kind === "enroll" ? "Enroll" : "Resume"}</span>
                                    <span className="next-title">{reco.title}</span>
                                  </span>
                                )}
                              </td>
                              <td className="cell-chevron" aria-hidden>
                                <ChevronRight size={18} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      {/* ---------------- Drawer ---------------- */}
      <div className={`drawer-scrim ${open ? "show" : ""}`} onClick={() => setOpenId(null)} aria-hidden />
      <aside className={`drawer ${open ? "open" : ""}`} aria-label="Learner details" aria-hidden={!open}>
        {open && (
          <LearnerDetail key={open.id} learner={open} onClose={() => setOpenId(null)} onEnroll={enroll} onNudge={nudge} />
        )}
      </aside>

      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Learner detail (drawer)
// ---------------------------------------------------------------------------

function LearnerDetail({
  learner,
  onClose,
  onEnroll,
  onNudge,
}: {
  learner: LearnerView;
  onClose: () => void;
  onEnroll: (l: LearnerView, courseId: string, title: string) => Promise<void>;
  onNudge: (l: LearnerView, c: CourseView) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ key, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const goalsEarned = learner.goals.filter((g) => g.earned).length;
  const reco = learner.recommendation;
  const tz = learner.timezone;
  const firstName = learner.name.split(" ")[0];
  const atRisk = learner.courses.filter((c) => c.status === "at-risk");
  const maxIdle = Math.max(0, ...atRisk.map((c) => c.daysInactive));
  /** A full week or more without study is escalated from "needs attention" to "urgent". */
  const urgent = maxIdle >= 7;

  return (
    <div className="detail">
      <header className="drawer-head">
        <Avatar name={learner.name} size="lg" />
        <div className="hero-text">
          <h2>{learner.name}</h2>
          <p>
            {learner.centerName} · {plural(learner.courses.length, "course")} · {plural(learner.earnedSkills.length, "skill")} earned
          </p>
          <StatusBadge status={learner.status} />
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close details" autoFocus>
          <X size={20} />
        </button>
      </header>

      <div className="drawer-body">
        {atRisk.length > 0 && (
          <section className={`alert ${urgent ? "urgent" : ""}`} aria-label="Needs attention">
            <div className="alert-head">
              <span className="alert-icon">
                <TriangleAlert size={20} />
              </span>
              <div>
                <h3>
                  {urgent ? "Urgent" : "Needs attention"} · idle {plural(maxIdle, "day")}
                </h3>
                <p>
                  {firstName} hasn&apos;t studied {atRisk.length > 1 ? `${atRisk.length} courses` : "a course"} for more than 3 days.
                  {reco.kind === "resume" && ` Reach out today and ask ${firstName} to resume ${reco.title}.`}
                </p>
              </div>
            </div>
            <ul className="alert-list">
              {atRisk.map((c) => (
                <li key={c.enrollmentId}>
                  <div className="alert-course">
                    <b>{c.title}</b>
                    <span>
                      No activity for {plural(c.daysInactive, "day")} · last active {formatDay(c.lastActiveAt, tz)} · {c.percent}% done
                    </span>
                  </div>
                  <div className="alert-actions">
                    {c.lastNudgedAt && (
                      <span className="nudged">
                        <Check size={13} /> Nudged {formatDay(c.lastNudgedAt, tz)}
                      </span>
                    )}
                    <button
                      className={`btn ${c.lastNudgedAt ? "btn-ghost" : "btn-alert"}`}
                      disabled={busy !== null}
                      onClick={() => run(`nudge-${c.enrollmentId}`, () => onNudge(learner, c))}
                    >
                      <Send size={14} />
                      {busy === `nudge-${c.enrollmentId}` ? "Saving…" : c.lastNudgedAt ? "Nudge again" : "Log nudge"}
                    </button>
                  </div>
                  {error?.key === `nudge-${c.enrollmentId}` && (
                    <span className="error-text" role="alert">
                      {error.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="stats">
          <div className="stat stat-wide">
            <div className="stat-label">
              <CalendarDays size={14} /> Active days · last 7
            </div>
            <div className="stat-value">
              {learner.activeDays.count}
              <span>/7</span>
            </div>
            <div className="week" aria-hidden>
              {learner.activeDays.days.map((d) => (
                <div key={d.date} className={`day ${d.active ? "on" : ""}`} title={d.date}>
                  <i />
                  <span>{dayParts(d.date).narrow}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="stat stat-ring">
            <div>
              <div className="stat-label">
                <Target size={14} /> Goals reached
              </div>
              <div className="stat-value">
                {goalsEarned}
                <span>/{learner.goals.length}</span>
              </div>
            </div>
            <GoalRing earned={goalsEarned} total={learner.goals.length} />
          </div>

          <div className="stat">
            <div className="stat-label">
              <Award size={14} /> Skills earned
            </div>
            <div className="stat-value">{learner.earnedSkills.length}</div>
            <div className="stat-foot">At 80% of a course</div>
          </div>
        </div>

        <section className="block">
          <h3 className="block-title">Recommended next</h3>
          {reco.kind === "none" ? (
            <div className="reco reco-none">
              <Inbox size={18} />
              <p>{reco.reason}</p>
            </div>
          ) : (
            <div className="reco">
              <div className="reco-icon">{reco.kind === "enroll" ? <Sparkles size={20} /> : <RefreshCw size={20} />}</div>
              <div className="reco-body">
                <span className="reco-tag">{reco.kind === "enroll" ? "Enroll" : "Resume"}</span>
                <h4>{reco.title}</h4>
                <p>{reco.reason}</p>
                {reco.kind === "enroll" && (
                  <>
                    <button
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => run("enroll", () => onEnroll(learner, reco.courseId, reco.title))}
                    >
                      {busy === "enroll" ? "Enrolling…" : `Enroll in ${reco.title}`}
                      {busy !== "enroll" && <ArrowRight size={16} />}
                    </button>
                    {error?.key === "enroll" && (
                      <p className="error-text" role="alert">
                        {error.message}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="block">
          <h3 className="block-title">
            Courses <span className="count">{learner.courses.length}</span>
          </h3>
          {learner.courses.length === 0 ? (
            <div className="empty-inline">
              <BookOpen size={18} />
              <p>Not enrolled in any course yet. Use the recommendation above to get started.</p>
            </div>
          ) : (
            <div className="courses">
              {learner.courses.map((c) => (
                <div key={c.enrollmentId} className={`course ${c.status}`}>
                  <div className="course-top">
                    <div>
                      <h4>{c.title}</h4>
                      <div className="course-skills">{c.skills.join(" · ")}</div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>

                  <div className="progress-row">
                    <div
                      className="bar"
                      role="progressbar"
                      aria-valuenow={c.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${c.title} progress`}
                    >
                      <span style={{ width: `${c.percent}%` }} />
                    </div>
                    <span className="pct">{c.percent}%</span>
                  </div>

                  <div className="course-meta">
                    <span>
                      <BookOpen size={13} /> {c.completedLessons}/{c.totalLessons} lessons
                    </span>
                    <span>
                      <Clock size={13} />
                      {c.lastActiveIsEnrollment
                        ? `Enrolled ${formatDay(c.lastActiveAt, tz)}, not started`
                        : `Last active ${formatDay(c.lastActiveAt, tz)} · ${ago(c.daysInactive)}`}
                    </span>
                  </div>

                  {c.missingPrerequisites.length > 0 && c.status !== "completed" && (
                    <div className="warn">
                      <Lock size={13} /> Started before finishing {c.missingPrerequisites.join(", ")}
                    </div>
                  )}

                </div>
              ))}
            </div>
          )}
        </section>

        <div className="two-col">
          <section className="block">
            <h3 className="block-title">Goals</h3>
            {learner.goals.length === 0 ? (
              <p className="muted">No goals set.</p>
            ) : (
              <div className="chips">
                {learner.goals.map((g) => (
                  <span key={g.skill} className={`chip ${g.earned ? "earned" : "pending"}`}>
                    {g.earned ? <Check size={13} /> : <Target size={13} />}
                    {g.skill}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="block">
            <h3 className="block-title">Earned skills</h3>
            {learner.earnedSkills.length === 0 ? (
              <p className="muted">None yet. A skill is earned at 80% of the course that teaches it.</p>
            ) : (
              <div className="chips">
                {learner.earnedSkills.map((s) => (
                  <span key={s.skill} className="chip skill" title={`From ${s.fromCourse}`}>
                    <Award size={13} />
                    {s.skill}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "grid", gap: 20 }}>
      <div className="skel" style={{ height: 84, borderRadius: 16 }} />
      <div className="skel" style={{ height: 300, borderRadius: 16 }} />
      <div className="card" style={{ padding: 20, display: "grid", gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel" style={{ height: 52 }} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="card state">
      <span className="state-icon">
        <Inbox size={22} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card state" role="alert">
      <span className="state-icon risk">
        <TriangleAlert size={22} />
      </span>
      <h2>Couldn&apos;t load the dashboard</h2>
      <p>{message}</p>
      <button className="btn" onClick={onRetry}>
        <RefreshCw size={16} /> Try again
      </button>
    </div>
  );
}
