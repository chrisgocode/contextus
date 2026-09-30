import { notFound } from "next/navigation";

// `/user` names no player; show the profile not-found page rather than the
// generic one.
export default function UserIndexPage() {
  notFound();
}
