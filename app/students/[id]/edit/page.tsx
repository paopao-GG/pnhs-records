import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudent, getSubjectsForStudent, getTerms } from "@/lib/db/queries.ts";
import { requireUnlocked } from "@/lib/auth/guard.ts";
import { GradeEditor } from "@/app/_components/grade-editor.tsx";

export const dynamic = "force-dynamic";

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUnlocked();

  const { id } = await params;
  const studentId = Number(id);
  const student = await getStudent(studentId);
  if (!student) notFound();

  // One query for every subject rather than one per term - see getSubjectsForStudent().
  const [terms, subjectsByTerm] = await Promise.all([
    getTerms(studentId),
    getSubjectsForStudent(studentId),
  ]);
  const bundles = terms.map((term) => ({ term, subjects: subjectsByTerm.get(term.id) ?? [] }));

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


      <div className="notice" data-tone="info">
        Enter quarterly ratings only — the printed SF10 recomputes final ratings and the general
        average with its own formulas, so the form and this screen always agree. Grades save
        themselves as you type. <strong>Enter</strong> or <strong>↓</strong> moves down a column,
        <strong> Tab</strong> moves across a row.
      </div>

      <GradeEditor student={student} bundles={bundles} />
    </main>
  );
}
