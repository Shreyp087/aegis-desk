"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    if (!open) {
      setHoldMs(0);
      setHolding(false);
      setOtpInput("");
    }
  }, [open]);

  function stopRaf() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
  }

  function tick() {
    if (!startRef.current) startRef.current = performance.now();
    const elapsed = performance.now() - startRef.current;
    setHoldMs(elapsed);
    rafRef.current = requestAnimationFrame(tick);
  }

  function startHold() {
    setHolding(true);
    setHoldMs(0);
    stopRaf();
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Step-up verification"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-900 shadow-xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            <div className="mt-1 text-sm text-slate-700">
              We only step-up when risk is elevated. No image CAPTCHAs.
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        {isL1 ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Level 1: Hold-to-confirm</div>
              <div className="mt-1 text-xs text-slate-700">
                Press and hold for 2 seconds to continue. Keyboard: hold Space or Enter.
              </div>

              <button
                className={`mt-3 w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                  holding
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
                }`}
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
              >
                {holding ? "Holding..." : "Press & Hold"}
              </button>

              <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-slate-900"
                  style={{ width: `${Math.min(100, (holdMs / requiredHold) * 100)}%` }}
                />
              </div>

              <div className="mt-2 text-xs text-slate-700">
                {canSubmitHold ? "Verified. You can continue." : `Holding: ${Math.floor(holdMs)}ms / ${requiredHold}ms`}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => onResult(false)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => onResult(true)}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmitHold}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {isL2 ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Level 2: OTP (demo MFA)</div>
              <div className="mt-1 text-xs text-slate-700">
                For hackathon demo, the OTP is displayed (mock delivery). In production, it would be delivered out-of-band.
              </div>

              <div className="mt-3 rounded-xl bg-slate-100 p-3 text-center">
                <div className="text-xs font-medium text-slate-600">OTP</div>
                <div className="text-2xl font-semibold tracking-widest text-slate-900">{otp}</div>
              </div>

              <label className="mt-3 block text-xs font-medium text-slate-700">Enter OTP</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                inputMode="numeric"
                placeholder="6 digits"
                aria-label="OTP input"
              />

              <div className="mt-2 text-xs text-slate-700">
                {canSubmitOtp ? "OTP verified." : "Type the OTP to continue."}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => onResult(false)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => onResult(true)}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmitOtp}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
