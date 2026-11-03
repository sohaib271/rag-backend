export const BOOKING_EMAIL_QUEUE = 'booking-emails';

export type BookingEmailRecipient = 'customer' | 'admin';
export type BookingEmailEvent = 'confirmed' | 'rescheduled';

export type BookingEmailJob = {
  bookingId: string;
  recipient: BookingEmailRecipient;
  event: BookingEmailEvent;
};
