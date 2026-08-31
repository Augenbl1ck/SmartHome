import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api-server';
import RoomClient from './RoomClient';

export const dynamic = 'force-dynamic';

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const roomId = Number(id);

  const [room, devices] = await Promise.all([
    serverApi.getRoom(roomId).catch(() => null),
    serverApi.getDevices(roomId).catch(() => []),
  ]);

  if (!room) notFound();

  return <RoomClient room={room} initialDevices={devices} />;
}
