import { describe, expect, it } from 'vitest';
import { detectCustomerIntent } from './intent-detection.js';

describe('detectCustomerIntent', () => {
  it('detects an explicit cancellation without calling Gemini', async () => {
    await expect(detectCustomerIntent('Cancel my appointment')).resolves.toMatchObject({
      intent: 'cancel_booking',
    });
  });

  it('detects explicit confirmation only while awaiting confirmation', async () => {
    await expect(detectCustomerIntent('Yes, confirm.', {
      bookingFlowState: 'awaiting_confirmation',
    })).resolves.toMatchObject({
      intent: 'confirm_booking',
    });
  });

  it('returns unknown for an empty message', async () => {
    await expect(detectCustomerIntent('   ')).resolves.toEqual({
      intent: 'unknown',
      confidence: 1,
      entities: {},
    });
  });
});
