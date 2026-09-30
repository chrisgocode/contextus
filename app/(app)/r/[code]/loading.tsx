"use client";

import { useParams } from "next/navigation";
import { isCreatedRoom } from "./_components/created-room";
import { RoomSkeleton } from "./_components/RoomSkeleton";

export default function RoomLoading() {
  const { code } = useParams<{ code: string }>();
  return <RoomSkeleton waiting={isCreatedRoom(code)} />;
}
