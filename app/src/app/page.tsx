"use client";

import { useState, useCallback } from "react";
import React from "react";
import {
  Shield,
  Lock,
  Milestone,
  Users,
  Clock,
  FileCheck,
  Receipt,
  ArrowLeftRight,
  Scale,
  Globe,
  Zap,
  Eye,
  Wallet,
  GitBranch,
  Award,
  RefreshCw,
  BarChart,
  Code,
  TestTube,
  Cpu,
  Coins,
  Key,
  Building,
  Handshake,
  ShoppingCart,
  Briefcase,
  Landmark,
  Plane,
  CheckCircle,
  ArrowUpRight,
  Play,
  ExternalLink,
  User,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { runDemoFlow } from "../lib/demo-flow";

/* ── Step data ── */
interface DiagramStep {
  title: string;
  desc: string;
  from: "buyer" | "escrow" | "seller";
  to: "buyer" | "escrow" | "seller";
  assetLabel: string;
  icon: LucideIcon;
  txIndex: number | null; // null = off-chain visual step
}

const STEP_COLOR = "#d4d4d8";

const STEPS: DiagramStep[] = [
  {
    title: "List",
    desc: "Seller registers product or service on-chain",
    from: "seller",
    to: "escrow",
    assetLabel: "Product",
    icon: Store,
    txIndex: null,
  },
  {
    title: "Deposit",
    desc: "Buyer locks 1,000 USDC in escrow vault",
    from: "buyer",
    to: "escrow",
    assetLabel: "1,000 USDC",
    icon: Lock,
    txIndex: 0,
  },
  {
    title: "Mint NFT",
    desc: "NFT receipt issued to seller as proof of receivable",
    from: "escrow",
    to: "seller",
    assetLabel: "NFT Receipt",
    icon: Award,
    txIndex: 1,
  },
  {
    title: "Deliver",
    desc: "Seller completes and submits deliverables",
    from: "seller",
    to: "buyer",
    assetLabel: "Deliverables",
    icon: FileCheck,
    txIndex: null,
  },
  {
    title: "Approve",
    desc: "Buyer verifies work and approves milestone",
    from: "buyer",
    to: "escrow",
    assetLabel: "Approved",
    icon: CheckCircle,
    txIndex: 2,
  },
  {
    title: "Settle",
    desc: "Escrow releases funds to NFT holder",
    from: "escrow",
    to: "seller",
    assetLabel: "1,000 USDC",
    icon: ArrowUpRight,
    txIndex: 3,
  },
];

/* Map tx activeStep (0-3) → display step index (0-5) */
function txToDisplay(txStep: number, flipped: boolean): number {
  // 0=List, 1=Deposit, 2=Mint NFT, 3=Deliver, 4=Approve, 5=Settle
  if (txStep >= 3) return 5;
  if (txStep >= 2) return 4; // Deliver(3) + Approve(4) revealed together
  if (txStep >= 1) return 2;
  if (txStep >= 0) return 1; // List(0) + Deposit(1)
  if (flipped) return 0;     // List shown during setup
  return -1;
}

/* Column x-positions (percentage-based) */
const COL = { buyer: 15, escrow: 50, seller: 85 };

/* ── Marquee data ── */
interface MarqueeTag {
  icon: LucideIcon;
  label: string;
}

const marqueeRows: { direction: "left" | "right"; tags: MarqueeTag[] }[] = [
  {
    direction: "right",
    tags: [
      { icon: Shield, label: "Trustless Payments" },
      { icon: Lock, label: "Fund Locking" },
      { icon: Milestone, label: "Milestone Release" },
      { icon: Users, label: "Multi-party" },
      { icon: Clock, label: "Auto-expiry" },
      { icon: FileCheck, label: "On-chain Proof" },
    ],
  },
  {
    direction: "left",
    tags: [
      { icon: Receipt, label: "NFT Receipt" },
      { icon: ArrowLeftRight, label: "Position Trading" },
      { icon: Scale, label: "Dispute Resolution" },
      { icon: Globe, label: "Cross-border" },
      { icon: Zap, label: "Instant Settlement" },
      { icon: Eye, label: "Full Transparency" },
    ],
  },
  {
    direction: "right",
    tags: [
      { icon: Wallet, label: "Token Agnostic" },
      { icon: Shield, label: "No Freeze Risk" },
      { icon: GitBranch, label: "Composable DeFi" },
      { icon: Award, label: "Reputation NFT" },
      { icon: RefreshCw, label: "Beneficiary Sync" },
      { icon: BarChart, label: "Fee Analytics" },
    ],
  },
  {
    direction: "left",
    tags: [
      { icon: Code, label: "14 Instructions" },
      { icon: TestTube, label: "76 Tests" },
      { icon: Cpu, label: "< 1 sec Finality" },
      { icon: Coins, label: "$0.001 per TX" },
      { icon: Lock, label: "Audited Code" },
      { icon: Key, label: "Permissionless" },
    ],
  },
  {
    direction: "right",
    tags: [
      { icon: Building, label: "Enterprise Ready" },
      { icon: Handshake, label: "Freelance Escrow" },
      { icon: ShoppingCart, label: "E-commerce" },
      { icon: Briefcase, label: "Service Contracts" },
      { icon: Landmark, label: "Real Estate" },
      { icon: Plane, label: "Travel Bookings" },
    ],
  },
];

export default function Home() {
  const [flipped, setFlipped] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [txSignatures, setTxSignatures] = useState<(string | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [setupMsg, setSetupMsg] = useState("");
  const [demoError, setDemoError] = useState("");
  const [demoRunning, setDemoRunning] = useState(false);

  const runDemo = useCallback(async () => {
    if (demoRunning) return;
    setFlipped(true);
    setActiveStep(-1);
    setTxSignatures([null, null, null, null]);
    setSetupMsg("Initializing...");
    setDemoError("");
    setDemoRunning(true);

    await runDemoFlow(
      (msg) => setSetupMsg(msg),
      (result) => {
        setTxSignatures((prev) => {
          const next = [...prev];
          next[result.step] = result.txSignature;
          return next;
        });
        setActiveStep(result.step);
        setSetupMsg("");
      },
      (error) => {
        setDemoError(error);
        setDemoRunning(false);
      }
    );
    setDemoRunning(false);
  }, [demoRunning]);

  const resetDemo = useCallback(() => {
    setActiveStep(-1);
    setFlipped(false);
    setTxSignatures([null, null, null, null]);
    setSetupMsg("");
    setDemoError("");
    setDemoRunning(false);
  }, []);

  const demoComplete =
    activeStep >= 3 && !demoRunning && !demoError;

  /* Arrow positions for each step */
  const arrows = STEPS.map((s) => ({
    x1: COL[s.from],
    x2: COL[s.to],
  }));

  return (
    <div
      className="min-h-screen bg-surface"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* ================================================================
          SECTION 1 -- Hero + Flip Card
          ================================================================ */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-28">
        <div style={{ perspective: "1200px" }}>
          <div className={`flip-inner ${flipped ? "flipped" : ""}`}>
            {/* ──── FRONT ──── */}
            <div className="flip-face flip-front w-full">
              <div className="bg-surface-raised border border-border rounded-2xl p-10 sm:p-16 text-center w-full">
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight">
                  SolEscrow
                </h1>
                <p className="text-text-secondary mt-4 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
                  Trustless escrow payments on Solana
                </p>
                <div className="mt-10">
                  <button
                    onClick={runDemo}
                    disabled={demoRunning}
                    className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-base font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 transition-all shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-5 h-5" />
                    Run Demo
                  </button>
                  <p className="text-xs text-text-muted mt-3">
                    Executes real transactions on Solana devnet
                  </p>
                </div>
              </div>
            </div>

            {/* ──── BACK: Flow Diagram ──── */}
            <div className="flip-face flip-back">
              <div className="bg-surface-raised border border-border rounded-2xl p-6 sm:p-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold text-text-primary">
                    Escrow Flow
                  </h2>
                  <div className="flex items-center gap-4">
                    {(activeStep >= 0 || flipped) && (
                      <span className="text-xs font-mono text-zinc-400">
                        Step{" "}
                        <span className="text-zinc-200">
                          {Math.min(txToDisplay(activeStep, flipped) + 1, STEPS.length)}
                        </span>
                        /{STEPS.length}
                      </span>
                    )}
                    <button
                      onClick={resetDemo}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 border border-zinc-700 hover:border-zinc-500 hover:text-white transition-all"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Replay
                    </button>
                  </div>
                </div>

                {setupMsg && (
                  <div className="flex items-center justify-center gap-3 py-3 mb-2 rounded-lg border border-zinc-800 bg-zinc-900/60">
                    <svg
                      className="w-3.5 h-3.5 text-violet-400 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        opacity="0.2"
                      />
                      <path
                        d="M12 2a10 10 0 0 1 10 10"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="text-xs font-mono text-zinc-400">
                      {setupMsg}
                    </span>
                  </div>
                )}
                {demoError && (
                  <div className="flex items-center justify-center gap-2 py-3 mb-2 rounded-lg border border-red-500/20 bg-red-500/5">
                    <span className="text-xs font-mono text-red-400">
                      {demoError}
                    </span>
                  </div>
                )}

                {/* ── Desktop Diagram ── */}
                <div className="hidden md:block">
                  <div className="relative" style={{ height: 410 }}>
                    {/* Column headers */}
                    {[
                      {
                        label: "BUYER",
                        x: COL.buyer,
                        Icon: User,
                        color: "#d4d4d8",
                      },
                      {
                        label: "ESCROW",
                        x: COL.escrow,
                        Icon: Shield,
                        color: "#a78bfa",
                      },
                      {
                        label: "SELLER",
                        x: COL.seller,
                        Icon: Store,
                        color: "#d4d4d8",
                      },
                    ].map((col) => (
                      <div
                        key={col.label}
                        className="absolute flex flex-col items-center gap-1.5"
                        style={{
                          left: `${col.x}%`,
                          top: 0,
                          transform: "translateX(-50%)",
                        }}
                      >
                        <col.Icon
                          className="w-4 h-4"
                          style={{ color: col.color, opacity: 0.7 }}
                        />
                        <span
                          className="text-[10px] font-medium tracking-[0.15em]"
                          style={{ color: col.color, opacity: 0.6 }}
                        >
                          {col.label}
                        </span>
                      </div>
                    ))}

                    {/* Vertical timeline lines (always visible) */}
                    {[
                      { x: COL.buyer, color: "rgba(212,212,216,0.06)" },
                      { x: COL.escrow, color: "rgba(167,139,250,0.1)" },
                      { x: COL.seller, color: "rgba(212,212,216,0.06)" },
                    ].map((line, i) => (
                      <div
                        key={i}
                        className="absolute"
                        style={{
                          left: `${line.x}%`,
                          top: 58,
                          bottom: 0,
                          width: 1,
                          background: line.color,
                          transform: "translateX(-0.5px)",
                        }}
                      />
                    ))}

                    {/* Step rows — arrows always visible, icons animate */}
                    {STEPS.map((step, i) => {
                      const rowY = 68 + i * 52;
                      const a = arrows[i];
                      const fromX = a.x1;
                      const toX = a.x2;
                      const goesRight = toX > fromX;
                      const displayIdx = txToDisplay(activeStep, flipped);
                      const isRevealed = i <= displayIdx;
                      const isActive = i === displayIdx;
                      const isOffChain = step.txIndex === null;
                      const IconComp = step.icon;

                      return (
                        <React.Fragment key={i}>
                          {/* Arrowhead */}
                          <div
                            className="absolute"
                            style={{
                              left: goesRight
                                ? `calc(${toX}% - 6px)`
                                : `calc(${toX}% - 2px)`,
                              top: rowY + 10,
                              width: 0,
                              height: 0,
                              borderTop: "5px solid transparent",
                              borderBottom: "5px solid transparent",
                              ...(goesRight
                                ? {
                                    borderLeft: `7px solid ${isRevealed ? STEP_COLOR : "#27272a"}`,
                                  }
                                : {
                                    borderRight: `7px solid ${isRevealed ? STEP_COLOR : "#27272a"}`,
                                  }),
                              transition:
                                "border-color 0.4s ease",
                            }}
                          />

                          {/* Horizontal arrow line (div-based for simplicity) */}
                          <div
                            className="absolute"
                            style={{
                              left: `calc(${Math.min(fromX, toX)}% + 6px)`,
                              top: rowY + 14,
                              width: `calc(${Math.abs(toX - fromX)}% - 14px)`,
                              height: isActive ? 2 : 1,
                              background: isRevealed
                                ? isOffChain
                                  ? "repeating-linear-gradient(90deg, #d4d4d8 0 4px, transparent 4px 8px)"
                                  : STEP_COLOR
                                : "#27272a",
                              transition:
                                "background 0.4s ease, height 0.3s ease",
                            }}
                          />

                          {/* Step label card — at the start of arrow */}
                          <div
                            className="absolute flex items-center gap-2"
                            style={{
                              left:
                                fromX < toX
                                  ? `calc(${fromX}% + 14px)`
                                  : `calc(${fromX}% - 14px)`,
                              top: rowY - 8,
                              transform:
                                fromX < toX
                                  ? "none"
                                  : "translateX(-100%)",
                            }}
                          >
                            <div
                              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold"
                              style={{
                                background: isRevealed
                                  ? `${STEP_COLOR}15`
                                  : "rgba(39,39,42,0.5)",
                                color: isRevealed
                                  ? STEP_COLOR
                                  : "#52525b",
                                border: `1px solid ${isRevealed ? `${STEP_COLOR}30` : "#27272a"}`,
                                transition:
                                  "all 0.4s ease",
                              }}
                            >
                              <IconComp className="w-3 h-3" />
                              <span className="font-mono">
                                {i + 1}
                              </span>
                              {step.title}
                            </div>
                          </div>

                          {/* Asset label below arrow */}
                          <div
                            className="absolute text-[9px] font-mono"
                            style={{
                              left: `${(fromX + toX) / 2}%`,
                              top: rowY + 22,
                              transform: "translateX(-50%)",
                              color: isRevealed
                                ? STEP_COLOR
                                : "#3f3f46",
                              opacity: isRevealed ? 0.8 : 0.4,
                              transition: "all 0.4s ease",
                            }}
                          >
                            {step.assetLabel}
                          </div>

                          {/* Tx link */}
                          {step.txIndex !== null &&
                            txSignatures[step.txIndex] && (
                            <a
                              href={`https://explorer.solana.com/tx/${txSignatures[step.txIndex]}?cluster=devnet`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute flex items-center gap-1 text-[9px] hover:opacity-100 transition-opacity"
                              style={{
                                left: `${(fromX + toX) / 2}%`,
                                top: rowY + 34,
                                transform: "translateX(-50%)",
                                color: STEP_COLOR,
                                opacity: 0.5,
                              }}
                            >
                              View Tx{" "}
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}

                          {/* Animated flow icon — slides from source to dest */}
                          <div
                            className={`absolute flex items-center justify-center rounded-full z-20 ${isActive ? "node-breathing" : ""}`}
                            style={{
                              width: 26,
                              height: 26,
                              background: isRevealed ? "#fafafa" : "#18181b",
                              border: isRevealed
                                ? "none"
                                : "1px solid #3f3f46",
                              boxShadow: isActive
                                ? "0 0 20px rgba(250,250,250,0.15)"
                                : isRevealed
                                  ? "0 1px 4px rgba(0,0,0,0.3)"
                                  : "none",
                              left: isRevealed
                                ? `calc(${toX}% - 13px)`
                                : `calc(${fromX}% - 13px)`,
                              top: rowY + 2,
                              transition: isRevealed
                                ? "left 1.2s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s ease, box-shadow 0.3s ease, border 0.3s ease"
                                : "none",
                              opacity: flipped ? 1 : 0,
                            }}
                          >
                            <IconComp
                              className="w-3 h-3"
                              style={{
                                color: isRevealed ? "#09090b" : "#52525b",
                                transition: "color 0.3s ease",
                              }}
                            />
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* ── Mobile Diagram ── */}
                <div className="md:hidden space-y-3">
                  {STEPS.map((step, i) => {
                    const displayIdx = txToDisplay(activeStep, flipped);
                    const isRevealed = i <= displayIdx;
                    const isActive = i === displayIdx;
                    const isPast = isRevealed && !isActive;
                    const isOffChain = step.txIndex === null;
                    const IconComp = step.icon;
                    const dirLabel =
                      step.from === "buyer" && step.to === "escrow"
                        ? "Buyer \u2192 Escrow"
                        : step.from === "seller" && step.to === "escrow"
                          ? "Seller \u2192 Escrow"
                          : step.from === "seller" && step.to === "buyer"
                            ? "Seller \u2192 Buyer"
                            : "Escrow \u2192 Seller";

                    return (
                      <React.Fragment key={i}>
                        {i > 0 && (
                          <div className="flex justify-center">
                            <div
                              className="w-0.5 h-6"
                              style={{
                                background: activeStep >= i
                                  ? "#3f3f46"
                                  : "#27272a",
                              }}
                            />
                          </div>
                        )}
                        <div
                          className={`diagram-node-mobile ${isRevealed ? "diagram-node-visible" : ""} ${isActive ? "node-breathing" : ""}`}
                          style={{
                            borderColor: isActive
                              ? "#a1a1aa"
                              : isPast
                                ? "#52525b"
                                : "#3f3f46",
                            borderStyle: isOffChain ? "dashed" : "solid",
                            boxShadow: isActive
                              ? "0 0 16px rgba(212,212,216,0.1)"
                              : "none",
                            opacity: isRevealed
                              ? isPast
                                ? 0.7
                                : 1
                              : 0,
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{
                                backgroundColor: isOffChain
                                  ? "rgba(212,212,216,0.05)"
                                  : "rgba(212,212,216,0.1)",
                                border: isOffChain
                                  ? "1px dashed rgba(212,212,216,0.2)"
                                  : "1px solid rgba(212,212,216,0.15)",
                              }}
                            >
                              <IconComp
                                className="w-3.5 h-3.5"
                                style={{ color: STEP_COLOR }}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                  style={{
                                    backgroundColor: isActive
                                      ? STEP_COLOR
                                      : "rgba(212,212,216,0.15)",
                                    color: isActive
                                      ? "#09090b"
                                      : "#71717a",
                                  }}
                                >
                                  {i + 1}
                                </span>
                                <h4 className="text-sm font-semibold text-zinc-100">
                                  {step.title}
                                </h4>
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                                  style={{
                                    backgroundColor: "rgba(212,212,216,0.06)",
                                    color: "#71717a",
                                  }}
                                >
                                  {dirLabel}
                                </span>
                              </div>
                              <p className="text-[11px] text-zinc-500 font-mono mt-0.5 ml-7">
                                {step.desc}
                              </p>
                              {step.txIndex !== null &&
                                txSignatures[step.txIndex] && (
                                <a
                                  href={`https://explorer.solana.com/tx/${txSignatures[step.txIndex]}?cluster=devnet`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 mt-1 text-[10px] transition-colors ml-7 text-zinc-400 hover:text-zinc-200"
                                >
                                  View Tx{" "}
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                  {demoComplete && (
                    <div className="mt-4 p-4 rounded-xl border border-zinc-700 bg-zinc-800/30 desc-enter">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle className="w-4 h-4 text-zinc-300" />
                        <span className="text-sm font-semibold text-zinc-200">
                          Escrow Complete
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {txSignatures.map(
                          (sig, i) =>
                            sig && (
                              <a
                                key={i}
                                href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:text-white transition-colors"
                              >
                                {(STEPS.find((s) => s.txIndex === i) ?? STEPS[0]).title}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Active step description / Completion */}
                <div className="mt-4 min-h-[56px]">
                  {demoComplete ? (
                    <div className="desc-enter text-center space-y-3">
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle className="w-4 h-4 text-zinc-300" />
                        <p className="text-sm font-semibold text-zinc-200">
                          Escrow Complete
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-3 flex-wrap">
                        {txSignatures.map(
                          (sig, i) =>
                            sig && (
                              <a
                                key={i}
                                href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono border border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                              >
                                {(STEPS.find((s) => s.txIndex === i) ?? STEPS[0]).title}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )
                        )}
                      </div>
                    </div>
                  ) : (activeStep >= 0 || flipped) ? (() => {
                    const di = txToDisplay(activeStep, flipped);
                    const ds = STEPS[di];
                    return ds ? (
                      <div key={di} className="desc-enter text-center">
                        <p className="text-sm font-medium text-zinc-200">
                          {ds.title}
                        </p>
                        <p className="text-xs text-zinc-500 mt-1 font-mono max-w-md mx-auto">
                          {ds.desc}
                        </p>
                      </div>
                    ) : null;
                  })() : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECTION 2 -- Comparison
          ================================================================ */}
      <section id="comparison" className="border-t border-border py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px flex-1 bg-border" />
            <span className="text-amber-500 text-xs font-semibold tracking-widest uppercase">
              Comparison
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold text-text-primary text-center mb-12 tracking-tight">
            Traditional vs On-Chain
          </h2>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="bg-surface-raised border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-text-primary mb-6 italic">
                Traditional
              </h3>
              <div className="space-y-4 font-mono text-sm">
                {[
                  { label: "Trust model", value: "Intermediary required" },
                  { label: "Escrow fee", value: "2–5% service charge" },
                  { label: "Settlement", value: "3–7 business days" },
                  { label: "Proof of payment", value: "Paper receipt" },
                ].map((item) => (
                  <div key={item.label} className="pb-1">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">{item.label}</span>
                      <span className="text-zinc-400">{item.value}</span>
                    </div>
                    <div className="h-3.5" />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-surface-raised border border-violet-500/20 rounded-xl p-6 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
              <div className="relative">
                <h3 className="text-lg font-semibold text-violet-400 mb-6">
                  On-Chain
                </h3>
                <div className="space-y-4 font-mono text-sm">
                  {[
                    {
                      label: "Trust model",
                      value: "Trustless",
                      why: "Smart contract replaces intermediary",
                    },
                    {
                      label: "Escrow fee",
                      value: "Flat 0.5%",
                      why: "No middleman margin — protocol fee only",
                    },
                    {
                      label: "Settlement",
                      value: "Sub-second",
                      why: "Solana block finality ~400ms",
                    },
                    {
                      label: "Proof of payment",
                      value: "Tradeable NFT",
                      why: "Tokenized receivable, composable with DeFi",
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between text-text-secondary">
                        <span className="text-zinc-500">{item.label}</span>
                        <span className="text-violet-400">{item.value}</span>
                      </div>
                      <p className="text-[10px] text-zinc-600 mt-0.5 text-right">
                        {item.why}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECTION 3 -- Feature Tags Marquee
          ================================================================ */}
      <section
        id="features"
        className="border-t border-border py-24 overflow-hidden"
      >
        <div className="max-w-5xl mx-auto px-6 mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-text-primary text-center tracking-tight">
            Features
          </h2>
          <p className="text-text-secondary text-center mt-3 text-base">
            Everything you need for trustless payments
          </p>
        </div>

        <div className="max-w-5xl mx-auto space-y-4 overflow-hidden">
          {marqueeRows.map((row, rowIdx) => (
            <div key={rowIdx} className="relative overflow-hidden">
              <div
                className="absolute left-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to right, #09090b, transparent)",
                }}
              />
              <div
                className="absolute right-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to left, #09090b, transparent)",
                }}
              />

              <div
                className={
                  row.direction === "right"
                    ? "animate-marquee-left"
                    : "animate-marquee-right"
                }
                style={{ display: "flex", width: "max-content" }}
              >
                {[...row.tags, ...row.tags].map((tag, tagIdx) => {
                  const IconComp = tag.icon;
                  return (
                    <div
                      key={`${rowIdx}-${tagIdx}`}
                      className="flex items-center gap-2 px-4 py-2 mx-2 rounded-full border border-zinc-700 bg-surface-raised text-text-secondary text-sm whitespace-nowrap hover:border-violet-500/30 hover:text-text-primary transition-colors"
                    >
                      <IconComp className="w-4 h-4 flex-shrink-0" />
                      <span>{tag.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8">
        <p className="text-center text-xs text-zinc-500">
          Built on Solana &middot; Open Source
        </p>
      </footer>
    </div>
  );
}
