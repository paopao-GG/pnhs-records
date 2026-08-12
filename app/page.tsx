import { listStudents } from "@/lib/db/queries.ts";
import { requireUser } from "@/lib/auth/current-user.ts";
import { StudentSearch } from "./_components/student-search.tsx";
import { CachedNotice } from "./_components/connection-state.tsx";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireUser();

  const students = await listStudents();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Registrar</div>
          <h2>Find a learner record</h2>
        </div>
      </div>

      {/*
       * The index is cached whole, so search keeps working offline. What it cannot promise is
       * that a learner added in the last hour is in it — hence the timestamp.
       */}
      <CachedNotice renderedAt={new Date().toISOString()} />

      <StudentSearch students={students} />

      <div className="foot">
        <span>School ID 301860</span>
        <span>3rd Dist.–Libon West · Albay · Region V</span>
        <span>Learner records — handle as confidential</span>
      </div>
    </main>
  );
}
