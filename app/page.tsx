import { listStudents } from "@/lib/db/queries.ts";
import { StudentSearch } from "./_components/student-search.tsx";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const students = listStudents();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Registrar</div>
          <h2>Find a learner record</h2>
        </div>
      </div>

      <StudentSearch students={students} />

      <div className="foot">
        <span>School ID 301860</span>
        <span>3rd Dist.–Libon West · Albay · Region V</span>
        <span>Demonstration data — no actual learner information</span>
      </div>
    </main>
  );
}
