import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://soubabood15.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function cors(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://soubabood15.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return json(origin, { error: "Server configuration is incomplete" }, 500);
  if (!authorization.startsWith("Bearer ")) return json(origin, { error: "Authentication required" }, 401);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = authorization.slice(7);
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || !userData.user) return json(origin, { error: "Invalid or expired session" }, 401);

  const { data: profile, error: profileError } = await admin
    .from("trainer_users")
    .select("id,role,active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.active !== true || String(profile.role).toLowerCase() !== "admin") {
    return json(origin, { error: "Administrator access required" }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json(origin, { error: "Invalid JSON body" }, 400); }
  const action = String(body.action || "create");

  try {
    if (action === "create") {
      const username = String(body.username || "").trim().toLowerCase();
      const fullName = String(body.full_name || "").trim();
      const password = String(body.password || "");
      const role = String(body.role || "agent").toLowerCase();
      if (!/^[a-z0-9._-]{3,50}$/.test(username)) return json(origin, { error: "Invalid username" }, 400);
      if (password.length < 10) return json(origin, { error: "Password must be at least 10 characters" }, 400);
      if (!["agent", "trainer", "quality", "admin"].includes(role)) return json(origin, { error: "Invalid role" }, 400);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: `${username}@ebook.com`, password, email_confirm: true,
        user_metadata: { username, full_name: fullName, role },
      });
      if (createError || !created.user) throw createError || new Error("User creation failed");
      const { data: saved, error: saveError } = await admin.from("trainer_users").insert({
        username, full_name: fullName || username, role, active: true, auth_user_id: created.user.id,
      }).select("id,username,full_name,role,active").single();
      if (saveError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw saveError;
      }
      return json(origin, { user: saved }, 201);
    }

    const profileId = String(body.user_id || "");
    if (!profileId) return json(origin, { error: "user_id is required" }, 400);
    const { data: target, error: targetError } = await admin.from("trainer_users")
      .select("id,username,auth_user_id").eq("id", profileId).maybeSingle();
    if (targetError || !target?.auth_user_id) return json(origin, { error: "Target user not found" }, 404);
    if (target.auth_user_id === userData.user.id && ["delete", "set_active"].includes(action)) {
      return json(origin, { error: "You cannot disable or delete your own Admin account" }, 400);
    }

    if (action === "change_password") {
      const password = String(body.password || "");
      if (password.length < 10) return json(origin, { error: "Password must be at least 10 characters" }, 400);
      const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
      if (error) throw error;
      return json(origin, { ok: true });
    }
    if (action === "set_active") {
      const active = body.active === true;
      const { error: authError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
        ban_duration: active ? "none" : "876000h",
      });
      if (authError) throw authError;
      const { error } = await admin.from("trainer_users").update({ active }).eq("id", profileId);
      if (error) throw error;
      return json(origin, { ok: true });
    }
    if (action === "delete") {
      const { error } = await admin.auth.admin.deleteUser(target.auth_user_id);
      if (error) throw error;
      await admin.from("trainer_users").delete().eq("id", profileId);
      return json(origin, { ok: true });
    }
    return json(origin, { error: "Unsupported action" }, 400);
  } catch (error) {
    return json(origin, { error: error instanceof Error ? error.message : "Operation failed" }, 400);
  }
});
