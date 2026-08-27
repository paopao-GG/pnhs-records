"use server";

import { revalidatePath } from "next/cache";
import { requireUnlocked } from "@/lib/auth/guard.ts";
import { passwordProblem, verifyPassword } from "@/lib/auth/password.ts";
import { isPasswordSet, setPassword } from "@/lib/auth/unlock.ts";
import { getDb } from "@/lib/db/index.ts";
import { backupTo, defaultBackupRoot } from "@/lib/backup.ts";

export interface SettingsState {
  error: string | null;
  done: string | null;
}

/**
 * Change the password.
 *
 * Asks for the current one even though the caller is already inside an unlocked app. The
 * unlocked state means "somebody opened this at some point today", which is not the same as
 * "the person at the keyboard knows the password" — an unattended machine is exactly the case
 * this guards, and it is the case the idle timeout exists for too.
 */
export async function changePassword(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  await requireUnlocked();

  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (!(await isPasswordSet())) return { error: "No password is set for this machine.", done: null };

  const db = await getDb();
  const row = await db.execute({
    sql: `SELECT value FROM school_settings WHERE key = ?`,
    args: ["app_password_hash"],
  });
  const stored = row.rows[0]?.value;
  if (stored == null || !(await verifyPassword(current, String(stored)))) {
    return { error: "The current password is incorrect.", done: null };
  }

  if (next !== confirm) return { error: "The two new passwords do not match.", done: null };

  const problem = passwordProblem(next);
  if (problem) return { error: problem, done: null };

  // Clears every open session, this one included, so the next click asks for the new password.
  await setPassword(next);

  return { error: null, done: "Password changed. You will be asked for it again." };
}

/**
 * Copy the database and the archived originals somewhere else.
 *
 * The destination is typed rather than picked from a dialog, because the folder that matters
 * is almost always a removable drive and a text field says so plainly. `lib/backup.ts` refuses
 * to write inside the data directory itself, which is the one destination that would look like
 * a backup and protect against nothing.
 */
export async function runBackup(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  await requireUnlocked();

  const target = String(form.get("target") ?? "").trim() || defaultBackupRoot();

  try {
    const written = await backupTo(target);
    revalidatePath("/settings");
    return {
      error: null,
      done: `Backed up to ${written.folder} — the database and ${written.originals} original ${
        written.originals === 1 ? "file" : "files"
      }.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), done: null };
  }
}
