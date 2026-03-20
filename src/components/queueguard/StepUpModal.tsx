"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AegisButton } from "@/components/ui/AegisPrimitives";
import type { RiskDecision } from "@/lib/queueguard/types";

function formatOtp(n: number) {
  return n.toString().padStart(6, "0");
}

export default function StepUpModal({
  open,
  decision,
  onClose,
  onResult,
}: {
  open: boolean;
  decision: RiskDecision | null;
  onClose: () => void;
  onResult: (passed: boolean) => void;
}) {
  const [holdMs, setHoldMs] = useState(0);
  const [holding, setHolding] = useState(false);
  const [otp] = useState(() => formatOtp(Math.floor(Math.random() * 1000000)));
  const [otpInput, setOtpInput] = useState("");

  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const isL1 = decision?.stepUpLevel === 1;
  const isL2 = decision?.stepUpLevel === 2;
  const requiredHold = 2000;
  const canSubmitHold = holdMs >= requiredHold;
  const canSubmitOtp = otpInput.trim() === otp;

  useEffect(() => {
    if (!holding) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = (timestamp: number) => {
      if (startRef.current === null) {
        startRef.current = timestamp;
      }
      setHoldMs(timestamp - startRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [holding]);

  function stopRaf() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
  }

  function startHold() {
    setHolding(true);
    setHoldMs(0);
    stopRaf();
    startRef.current = null;
  }

  function endHold() {
    setHolding(false);
    stopRaf();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!isL1) return;
    if ((e.key === " " || e.key === "Enter") && !holding) {
      e.preventDefault();
      startHold();
    }
  }

  function onKeyUp(e: React.KeyboardEvent) {
    if (!isL1) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      endHold();
    }
  }

  const title = useMemo(() => {
    if (!decision) return "Step-up verification";
    return `Step-up verification (Risk ${decision.risk}/100)`;
  }, [decision]);

  if (!open || !decision) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Step-up verification"
    >
      <div className="w-full max-w-lg rounded-3xl border border-foreground/8 bg-surface p-6 shadow-2xl md:p-7">
        <div className="flex items-start justify-between gap-3 border-b border-foreground/6 pb-4">
          <div className="min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest opacity-40">Verification</div>
            <h2 className="mt-2 text-xl font-medium tracking-tight">{title}</h2>
            <p className="mt-2 text-sm font-light leading-relaxed text-foreground/60">
              We only step up when risk is elevated. No image CAPTCHAs.
            </p>
          </div>
          <AegisButton variant="ghost" onClick={onClose}>
            Close
          </AegisButton>
        </div>

        {isL1 ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
              <div className="text-sm font-medium text-foreground">Level 1: Hold-to-confirm</div>
              <div className="mt-1 text-sm font-light leading-relaxed text-foreground/60">
                Press and hold for 2 seconds to continue. Keyboard: hold Space or Enter.
              </div>
              <button
                className={[
                  "mt-4 w-full rounded-full border px-4 py-3 text-sm font-medium transition-all duration-200 ease-out",
                  holding ? "border-accent bg-accent text-background" : "border-foreground/8 bg-surface text-foreground hover:-translate-y-0.5 hover:border-foreground/15",
                ].join(" ")}
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
              >
                {holding ? "Holding..." : "Press and Hold"}
              </button>
              <div className="mt-3 h-1.5 w-full rounded-full bg-foreground/10">
                <div className="h-1.5 rounded-full bg-accent transition-[width] duration-75 ease-linear" style={{ width: `${Math.min(100, (holdMs / requiredHold) * 100)}%` }} />
              </div>
              <div className="mt-2 text-sm font-light text-foreground/60">
                {canSubmitHold ? "Verified. You can continue." : `Holding: ${Math.floor(holdMs)}ms / ${requiredHold}ms`}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <AegisButton variant="secondary" onClick={() => onResult(false)}>
                Cancel
              </AegisButton>
              <AegisButton onClick={() => onResult(true)} disabled={!canSubmitHold}>
                Continue
              </AegisButton>
            </div>
          </div>
        ) : null}

        {isL2 ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
              <div className="text-sm font-medium text-foreground">Level 2: OTP (demo MFA)</div>
              <div className="mt-1 text-sm font-light leading-relaxed text-foreground/60">
                For demo mode, the OTP is displayed. In production, it would be delivered out-of-band.
              </div>
              <div className="mt-4 rounded-2xl border border-foreground/8 bg-surface p-4 text-center">
                <div className="text-xs font-mono uppercase tracking-widest opacity-40">OTP</div>
                <div className="mt-2 text-2xl font-mono tracking-[0.3em] text-foreground">{otp}</div>
              </div>
              <label className="mt-4 block text-xs font-mono uppercase tracking-widest opacity-40">Enter OTP</label>
              <input
                className="aegis-input mt-1"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                inputMode="numeric"
                placeholder="6 digits"
                aria-label="OTP input"
              />
              <div className="mt-2 text-sm font-light text-foreground/60">
                {canSubmitOtp ? "OTP verified." : "Type the OTP to continue."}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <AegisButton variant="secondary" onClick={() => onResult(false)}>
                Cancel
              </AegisButton>
              <AegisButton onClick={() => onResult(true)} disabled={!canSubmitOtp}>
                Continue
              </AegisButton>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
