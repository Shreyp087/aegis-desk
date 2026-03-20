"use client";

import { useEffect, useRef } from "react";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type HeroMetric = {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
};

export function HeroCanvas({ metrics }: { metrics: HeroMetric[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const onMove = (event: MouseEvent) => {
      const { clientX, clientY } = event;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const rotateX = ((clientY - centerY) / centerY) * -6;
      const rotateY = ((clientX - centerX) / centerX) * 8;
      el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    };

    const reset = () => {
      el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", reset);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", reset);
    };
  }, []);

  return (
    <div className="hero-canvas mt-10 w-full max-w-6xl">
      <div className="hero-canvas-stage h-[60vh] border border-foreground/8 bg-surface shadow-[0_20px_80px_rgb(15_15_18/0.08)] transition-transform duration-100 ease-out" ref={ref}>
        <div className="hero-grid" />
        <div className="hero-glow" />

        <div className="hero-layer absolute inset-0 flex items-center justify-center px-6 py-8">
          <div className="grid w-full max-w-5xl gap-4 md:grid-cols-3">
            {metrics.map((metric, index) => (
              <div
                key={metric.label}
                className={cn(
                  "hero-card rounded-2xl border p-5 text-left backdrop-blur-sm",
                  metric.highlight
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/8 bg-background/80 text-foreground"
                )}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <p className="mb-2 text-xs font-mono uppercase tracking-widest opacity-55">{metric.label}</p>
                <p className="text-2xl font-medium tracking-tight">{metric.value}</p>
                <p className="mt-1 text-sm font-light leading-relaxed opacity-65">{metric.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
