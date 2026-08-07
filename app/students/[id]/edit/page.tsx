import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudent, getSubjects, getTerms } from "@/lib/db/queries.ts";
import { GradeEditor } from "@/app/_components/grade-editor.tsx";

export const dynamic = "force-dynamic";

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studentId = Number(id);
  const student = getStudent(studentId);
  if (!student) notFound();

  const bundles = getTerms(studentId).map((term) => ({ term, subjects: getSubjects(term.id) }));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href={`/students/${studentId}`}>← Back to record</Link>
          </div>
          <h2>
            Editing {student.last_name}, {student.first_name}
          </h2>
        </div>
      </div>

      <div className="notice">
        Enter quarterly ratings only. The printed SF10 recomputes final ratings and the general
        average with its own formulas, so the form and this screen always agree.
      </div>

      <GradeEditor student={student} bundles={bundles} />
    </main>
  );
}
