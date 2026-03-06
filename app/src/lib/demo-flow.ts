/**
 * Client-side demo flow — calls the server-side API route to execute
 * transactions securely (private key never leaves the server).
 */

/* ── Public types ── */
export interface StepResult {
  step: number; // 0-3
  txSignature: string;
}

export type SetupCallback = (msg: string) => void;
export type StepCallback = (result: StepResult) => void;
export type ErrorCallback = (error: string) => void;

/** Delay helper for smooth UI animations between steps */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Main demo flow ── */
export async function runDemoFlow(
  onSetup: SetupCallback,
  onStep: StepCallback,
  onError: ErrorCallback
): Promise<void> {
  try {
    onSetup("Executing escrow lifecycle on devnet...");

    const res = await fetch("/api/demo", { method: "POST" });
    const data = await res.json();

    if (!res.ok || data.error) {
      onError(data.error ?? `Server error: ${res.status}`);
      return;
    }

    const signatures: string[] = data.signatures;

    // Animate through the 4 steps with delays for UI effect
    for (let i = 0; i < signatures.length; i++) {
      onStep({ step: i, txSignature: signatures[i] });
      if (i < signatures.length - 1) {
        await delay(1500);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(msg);
  }
}
