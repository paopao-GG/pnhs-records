import Link from "next/link";
import { requireUnlocked } from "@/lib/auth/guard.ts";
import { NewStudentForm } from "@/app/_components/new-student-form.tsx";

export const dynamic = "force-dynamic";

export default async function NewStudentPage() {
  await requireUnlocked();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/">← All records</Link>
          </div>
          <h2>New learner record</h2>
        </div>
      </div>

      {/* This used to say the term arrives pre-filled with the standard subjects. It has not
          done that since subjects became one-at-a-time — createRecord() opens the term empty. */}
      <div className="notice">
        Creating a record also opens its first enrolment term, with no subjects yet — add them
        one at a time in the editor. Further years can be added afterwards.{" "}
        <strong>Grading periods</strong> is three from SY 2026&ndash;2027; choose four when
        back-encoding an earlier year.
      </div>

      <NewStudentForm />
    </main>
  );
}
