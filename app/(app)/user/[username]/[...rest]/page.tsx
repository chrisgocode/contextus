import { notFound } from "next/navigation";

// Profiles have no subpages; show the profile not-found page rather than the
// generic one.
export default function UserSubpage() {
  notFound();
}
