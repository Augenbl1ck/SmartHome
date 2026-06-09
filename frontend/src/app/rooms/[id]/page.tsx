import { serverApi } from '@/lib/api-server';
import RoomClient from './RoomClient';

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const roomId = Number(id);

  const [room, devices] = await Promise.all([
    serverApi.getRoom(roomId),
    serverApi.getDevices(roomId),
  ]);

  return <RoomClient room={room} initialDevices={devices} />;
}
