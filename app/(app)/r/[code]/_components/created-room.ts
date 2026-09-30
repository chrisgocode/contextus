// A room just created from home always opens on the game setup calendar.
// Home records its code before navigating so the room route's loading states
// keep showing the calendar skeleton instead of the neutral one.
let createdRoomCode: string | null = null;

export function markRoomCreated(code: string) {
  createdRoomCode = code.toUpperCase();
}

export function isCreatedRoom(code: string) {
  return createdRoomCode === code.toUpperCase();
}

export function clearCreatedRoom(code: string) {
  if (isCreatedRoom(code)) createdRoomCode = null;
}
