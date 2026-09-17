import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Invalid or expired session' }, 401);

  let payload: { action?: string; confirmation?: string } = {};
  try { payload = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  if (payload.action === 'deactivate') {
    const { error } = await admin.from('profiles').update({
      account_status: 'deactivated',
      deactivated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (error) return json({ error: 'Could not deactivate the account' }, 500);
    await admin.auth.admin.signOut(user.id, 'global');
    return json({ ok: true, action: 'deactivated' });
  }

  if (payload.action === 'delete') {
    if (payload.confirmation !== 'DELETE') return json({ error: 'Type DELETE to permanently delete the account' }, 400);

    // Account deletion is intentionally performed server-side with the service role.
    // Database foreign keys remain responsible for cascading owned application rows;
    // financial/legal records should use their own retention/anonymisation policy.
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) return json({ error: 'Account deletion could not be completed' }, 500);
    return json({ ok: true, action: 'deleted' });
  }

  return json({ error: 'Unsupported account action' }, 400);
});
