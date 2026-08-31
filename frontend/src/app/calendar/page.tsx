import { serverApi } from '@/lib/api-server';
import type { CalendarEventsResponse } from '@/lib/api';
import CalendarClient from './CalendarClient';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const initial = await serverApi.getMonthCalendar(year, month).catch((): CalendarEventsResponse => ({
    events: [],
    configured: false,
    error: 'Kalender nicht erreichbar',
  }));

  return (
    <CalendarClient
      initialYear={year}
      initialMonth={month}
      initial={initial}
    />
  );
}
