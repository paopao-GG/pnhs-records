"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/current-user.ts";
import { passwordProblem } from "@/lib/auth/password.ts";
import {
  countActiveAdmins,
  createUser,
  getUser,
  setPassword,
  setUserActive,
  type Role,
} from "@/lib/db/users.ts";

export interface AdminState {
  error: string | null;
  notice: string | null;
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/i;

export async function createAccount(_prev: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin();

  const username = String(form.get("username") ?? "").trim();
  const fullName = String(form.get("fullName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const role = String(form.get("role") ?? "adviser") as Role;

  if (!USERNAME.test(username)) {
    return {
      error: "Usernames are 3-32 characters: letters, digits, dot, dash or underscore.",
      notice: null,
    };
  }
  if (!fullName) return { error: "Enter the person's full name.", notice: null };
  if (role !== "admin" && role !== "adviser") {
    return { error: "Choose a role.", notice: null };
  }

  const problem = passwordProblem(password, username);
  if (problem) return { error: problem, notice: null };

  try {
    await createUser({ username, fullName, password, role });
  } catch (err) {
    // UNIQUE(username) is the expected failure here and deserves a readable message.
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(message)) {
      return { error: `The username "${username}" is already taken.`, notice: null };
    }
    throw err;
  }

  revalidatePath("/admin/users");
  return { error: null, notice: `Created ${role} account "${username}".` };
}

export async function resetPassword(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();

  const userId = Number(form.get("userId"));
  const password = String(form.get("password") ?? "");
  if (!Number.isInteger(userId)) return { error: "Unknown account.", notice: null };

  const target = await getUser(userId);
  if (!target) return { error: "That account no longer exists.", notice: null };

  const problem = passwordProblem(password, target.username);
  if (problem) return { error: problem, notice: null };

  // An admin resetting their own password stays signed in here; every other session of theirs
  // ends. Resetting somebody else's ends all of theirs, which is the point of a reset.
  await setPassword(userId, password, userId === admin.id ? admin.session_id : undefined);

  revalidatePath("/admin/users");
  return {
    error: null,
    notice: `Password changed for "${target.username}". Their other sessions were signed out.`,
  };
}

export async function setActive(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();

  const userId = Number(form.get("userId"));
  const active = String(form.get("active")) === "1";
  if (!Number.isInteger(userId)) return { error: "Unknown account.", notice: null };

  const target = await getUser(userId);
  if (!target) return { error: "That account no longer exists.", notice: null };

  /*
   * Two locks that exist so nobody can shut themselves out of their own system.
   *
   * Only an admin can restore a deleted record or issue an account. Deactivating the last one
   * leaves a database that cannot be administered by anyone, and no way back through the UI.
   */
  if (!active && target.id === admin.id) {
    return { error: "You cannot deactivate your own account.", notice: null };
  }
  if (!active && target.role === "admin" && (await countActiveAdmins()) <= 1) {
    return {
      error: "That is the only active admin. Create another before deactivating this one.",
      notice: null,
    };
  }

  await setUserActive(userId, active);

  revalidatePath("/admin/users");
  return {
    error: null,
    notice: active
      ? `Reactivated "${target.username}".`
      : `Deactivated "${target.username}" and signed them out.`,
  };
}
