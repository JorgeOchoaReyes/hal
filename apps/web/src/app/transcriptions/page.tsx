import { redirect } from "next/navigation";

/** Old route name — keep old links working. */
export default function TranscriptionsRedirect() {
  redirect("/production-calls");
}
