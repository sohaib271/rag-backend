import { describe, expect, it } from 'vitest';
import { parseLocalAppointment } from './booking.service.js';

describe('parseLocalAppointment', () => {
  it('converts a Pakistan local appointment to UTC', () => {
    expect(
      parseLocalAppointment('2030-01-15', '3:30 PM', 'Asia/Karachi')?.toISOString(),
    ).toBe('2030-01-15T10:30:00.000Z');
  });

  it('supports 24-hour time', () => {
    expect(
      parseLocalAppointment('2030-01-15', '15:30', 'Asia/Karachi')?.toISOString(),
    ).toBe('2030-01-15T10:30:00.000Z');
  });

  it('supports conversational punctuation and ordinal dates', () => {
    expect(
      parseLocalAppointment('October 30th, 2030', 'at 2:30 p.m.', 'Asia/Karachi')?.toISOString(),
    ).toBe('2030-10-30T09:30:00.000Z');
  });

  it('supports weekday expressions', () => {
    const result = parseLocalAppointment('next Friday', '3 PM', 'Asia/Karachi');
    expect(result).not.toBeNull();
    expect(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      weekday: 'long',
    }).format(result!)).toBe('Friday');
  });

  it('treats "this Sunday" as the upcoming Sunday', () => {
    const result = parseLocalAppointment('This Sunday', '2 PM', 'Asia/Karachi');
    expect(result).not.toBeNull();
    expect(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      weekday: 'long',
    }).format(result!)).toBe('Sunday');
    expect(result!.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
  });

  it('rejects unrecognised text containing a weekday instead of guessing', () => {
    expect(
      parseLocalAppointment('around Sunday sometime', '2 PM', 'Asia/Karachi'),
    ).toBeNull();
  });

  it('rejects invalid dates and times', () => {
    expect(parseLocalAppointment('2030-02-30', '3 PM', 'Asia/Karachi')).toBeNull();
    expect(parseLocalAppointment('2030-02-20', '29:00', 'Asia/Karachi')).toBeNull();
  });
});
