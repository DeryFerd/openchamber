import { describe, expect, test } from 'bun:test';
import { composeContextBreakdown } from './contextBreakdown';

const estimate = (user: number, assistant: number, tool: number) => ({ user, assistant, tool, other: 0 });

describe('composeContextBreakdown', () => {
  test('measures every segment against the window the readout reports', () => {
    // The estimate is a whole-conversation character count; the window is what
    // the last turn actually filled. Both sides of the bar now share the window
    // as denominator, so the four segments add up to it.
    const breakdown = composeContextBreakdown(estimate(100, 200, 300), 1000);
    expect(breakdown).toEqual({ user: 100, assistant: 200, tool: 300, other: 400, total: 1000 });
  });

  test('reports the unattributed remainder as other instead of clamping it to zero', () => {
    // System prompt, tool and MCP schemas, skills and estimation error are real
    // window cost the per-message estimate cannot name. Folding them into a
    // clamp made other structurally 0%.
    const breakdown = composeContextBreakdown(estimate(50, 50, 50), 100_000);
    expect(breakdown.other).toBe(99_850);
    expect(breakdown.total).toBe(100_000);
  });

  test('grows the denominator to the estimate so no segment passes the window', () => {
    // A conversation longer than the model keeps can estimate past the window;
    // other must stay a non-negative remainder, never a negative one.
    const breakdown = composeContextBreakdown(estimate(400, 400, 400), 500);
    expect(breakdown.other).toBe(0);
    expect(breakdown.total).toBe(1200);
  });

  test('falls back to the estimate when the window is unknown', () => {
    // Compacted, or a turn that reported no tokens: the estimate is all there is.
    const breakdown = composeContextBreakdown(estimate(10, 20, 30), 0);
    expect(breakdown).toEqual({ user: 10, assistant: 20, tool: 30, other: 0, total: 60 });
  });
});
