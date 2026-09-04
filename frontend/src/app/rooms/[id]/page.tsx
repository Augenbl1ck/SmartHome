import { serverApi } from '@/lib/api-server';
import RoomClient from './RoomClient';

export const dynamic = 'force-dynamic';

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const roomId = Number(id);

  const boot = await serverApi.getBootstrap();
  const room = boot.rooms.find(r => r.id === roomId) ?? null;
  const devices = boot.devices.filter(d => d.room_id === roomId);

  return <RoomClient roomId={roomId} room={room} initialDevices={devices} />;
}
