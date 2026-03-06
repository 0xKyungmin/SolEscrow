/**
 * Client-side demo flow — streams progress from the server-side API route.
 * Each step appears on screen as soon as it confirms on-chain.
 */

/* ── Public types ── */
export interface StepResult {
  step: number; // 0-3
  txSignature: string;
}

export type SetupCallback = (msg: string) => void;
export type StepCallback = (result: StepResult) => void;
export type ErrorCallback = (error: string) => void;

/* ── Main demo flow ── */
export async function runDemoFlow(
  onSetup: SetupCallback,
  onStep: StepCallback,
  onError: ErrorCallback
): Promise<void> {
  try {
    onSetup("Connecting to devnet...");

    const res = await fetch("/api/demo", { method: "POST" });

    if (!res.ok || !res.body) {
      onError(`Server error: ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === "setup") {
          onSetup(event.msg);
        } else if (event.type === "step") {
          onStep({ step: event.step, txSignature: event.txSignature });
        } else if (event.type === "error") {
          onError(event.error);
          return;
        }
        // "done" — loop will end naturally
      }
    }

    onSetup(""); // clear setup message when stream ends
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(msg);
  }
}
