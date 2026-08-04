import { createClient } from "npm:@supabase/supabase-js@2.45.4";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return Response.json({ error: "Missing Supabase environment variables" }, { status: 500 });
  }

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;

  while (true) {
    const { data: calls, error: listError } = await db
      .from("quality_calls")
      .select("id,audio_path")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(500);

    if (listError) return Response.json({ error: listError.message }, { status: 500 });
    if (!calls?.length) break;

    const paths = calls.map((call) => call.audio_path).filter(Boolean);
    if (paths.length) {
      const { error: storageError } = await db.storage.from("quality-calls").remove(paths);
      if (storageError) return Response.json({ error: storageError.message, deleted }, { status: 500 });
    }

    const { error: deleteError } = await db
      .from("quality_calls")
      .delete()
      .in("id", calls.map((call) => call.id));
    if (deleteError) return Response.json({ error: deleteError.message, deleted }, { status: 500 });
    deleted += calls.length;
  }

  return Response.json({ ok: true, deleted, cutoff });
});

