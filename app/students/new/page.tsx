import Link from "next/link";
import { NewStudentForm } from "@/app/_components/new-student-form.tsx";

export const dynamic = "force-dynamic";

export default function NewStudentPage() {
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

      <div className="notice">
        Creating a record also opens its first enrolment term, pre-filled with that grade
        level&rsquo;s standard subjects. Further years can be added afterwards.
      </div>

      <NewStudentForm />
    </main>
  );
}
