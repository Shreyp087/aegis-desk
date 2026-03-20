"use client";

import Link from "next/link";

import { HeroCanvas } from "@/components/HeroCanvas";

type WorkspaceLauncherProps = {
  offlinePublicEnabled: boolean;
  offlinePublicState: string;
};

type RouteCard = {
  href: string;
  title: string;
  summary: string;
};

const FLOW_STEPS = [
  {
    num: "01",
    title: "Scan Inbox",
    body: "AI classifies every message by urgency, uncertainty, and escalation pressure.",
  },
  {
    num: "02",
    title: "Escalate",
    body: "Move high-risk mail directly into the agent workspace without retyping context.",
  },
  {
    num: "03",
    title: "Analyze",
    body: "Reason through the thread, inspect claims, and draft a clear response path.",
  },
  {
    num: "04",
    title: "Resolve",
    body: "Convert the work into tickets and follow through to closure in one flow.",
  },
] as const;

const ROUTE_CARDS: RouteCard[] = [
  {
    href: "/inbox-scanner",
    title: "Inbox Scanner",
    summary: "Start with triage, risk ranking, and consensus-backed email review.",
  },
  {
    href: "/agent",
    title: "Agent Desk",
    summary: "Run structured analysis, evidence checks, and draft generation.",
  },
  {
    href: "/tickets",
    title: "Tickets",
    summary: "Track escalations through user and admin follow-through.",
  },
  {
    href: "/queueguard",
    title: "QueueGuard",
    summary: "Measure queue pressure, risk controls, and step-up outcomes.",
  },
];

function SectionHeading({ eyebrow, title, summary }: { eyebrow: string; title: string; summary: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="mb-5 text-xs font-mono uppercase tracking-[0.2em] text-foreground/40">{eyebrow}</p>
      <h2 className="text-3xl font-light tracking-tight md:text-4xl">{title}</h2>
      <p className="mt-4 text-base font-light leading-relaxed text-foreground/60">{summary}</p>
    </div>
  );
}

export default function WorkspaceLauncher({ offlinePublicEnabled, offlinePublicState }: WorkspaceLauncherProps) {
  const metrics = [
    {
      label: "INBOX",
      value: offlinePublicEnabled ? "Offline" : "Live",
      sub: `Workspace state: ${offlinePublicState}`,
    },
    {
      label: "RISK",
      value: "3",
      sub: "High-priority items queued for review.",
      highlight: true,
    },
    {
      label: "AGENT",
      value: "Active",
      sub: "Analysis desk ready for escalation.",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-6 md:px-8">
      <section id="launch" className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center py-8 text-center">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-foreground/40">Intelligence Operations Platform</p>

        <h1 className="mt-6 max-w-5xl text-5xl font-light tracking-tight md:text-7xl lg:text-8xl">
          Not just a desk.
          <br />
          <span className="font-medium">An intelligence layer.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg font-light leading-relaxed text-foreground/60 md:text-xl">
          Triage email risk, run AI analysis, and resolve tickets in one unified workspace with a calm editorial layout.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/inbox-scanner"
            className="inline-flex items-center justify-center rounded-full bg-foreground px-8 py-3 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-80"
          >
            Open Desk <span aria-hidden="true" className="ml-1">→</span>
          </Link>
          <Link
            href="/agent"
            className="inline-flex items-center justify-center rounded-full border border-foreground/12 px-8 py-3 text-sm font-medium text-foreground transition-colors duration-150 hover:border-foreground/24"
          >
            Agent Desk
          </Link>
        </div>

        <div className="mt-6 text-xs font-mono uppercase tracking-[0.16em] text-foreground/35">
          {offlinePublicEnabled ? `Offline ${offlinePublicState}` : "Live workspace"}
        </div>

        <HeroCanvas metrics={metrics} />
      </section>

      <section id="guide" className="py-24 md:py-32">
        <SectionHeading
          eyebrow="How it works"
          title="A quiet sequence from signal to resolution."
          summary="The layout stays simple on purpose. Each step keeps the next action obvious without visual noise."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {FLOW_STEPS.map((step, index) => (
            <div
              key={step.num}
              className="rounded-2xl border border-foreground/8 bg-surface p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/15"
            >
              <p className="text-xs font-mono uppercase tracking-widest text-foreground/35">{step.num}</p>
              <h3 className="mt-4 text-lg font-medium tracking-tight">{step.title}</h3>
              <p className="mt-3 text-sm font-light leading-relaxed text-foreground/60">{step.body}</p>
              <div className="mt-5 text-xs font-mono uppercase tracking-[0.18em] text-foreground/30">Step {index + 1}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="secondary" className="pb-24 md:pb-32">
        <SectionHeading
          eyebrow="Workspace Map"
          title="Everything stays direct. No hidden paths."
          summary="These are the same routes already in the app, presented as a clear entry map instead of a dense menu."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2">
          {ROUTE_CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-2xl border border-foreground/8 bg-surface p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/15"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-xl font-medium tracking-tight">{card.title}</h3>
                  <p className="mt-3 text-sm font-light leading-relaxed text-foreground/60">{card.summary}</p>
                </div>
                <span className="text-sm text-foreground/35 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer id="access" className="flex flex-col gap-3 border-t border-foreground/8 py-6 text-sm text-foreground/55 md:flex-row md:items-center md:justify-between">
        <div className="text-sm font-light tracking-tight text-foreground/60">
          Not just a desk. <span className="font-medium text-foreground">An intelligence layer.</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="transition-colors duration-150 hover:text-foreground" href="/sign-in">
            Sign in
          </Link>
          <Link className="transition-colors duration-150 hover:text-foreground" href="/sign-up">
            Sign up
          </Link>
        </div>
      </footer>
    </div>
  );
}
