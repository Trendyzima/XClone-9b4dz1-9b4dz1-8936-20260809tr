create or replace function private.claim_identity_verification_job(p_worker_id text)
returns table (
  job_id uuid,
  session_id uuid,
  attempts integer,
  leased_until timestamptz,
  evidence jsonb
)
language plpgsql
security definer
set search_path = private, public
as $$
declare
  lease_until timestamptz := now() + interval '2 minutes';
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 8 or length(trim(p_worker_id)) > 128 then
    raise exception 'INVALID_WORKER_ID';
  end if;

  return query
  with candidate as (
    select j.id
    from private.identity_verification_jobs j
    where (
      (j.state = 'queued' and j.available_at <= now())
      or (j.state = 'leased' and j.leased_until < now())
    )
    and j.attempts < 5
    order by j.available_at asc, j.created_at asc
    for update skip locked
    limit 1
  ),
  leased as (
    update private.identity_verification_jobs j
    set state = 'leased',
        attempts = j.attempts + 1,
        leased_until = lease_until,
        worker_id = trim(p_worker_id),
        updated_at = now()
    from candidate c
    where j.id = c.id
    returning j.id, j.session_id, j.attempts, j.leased_until
  )
  select l.id,
         l.session_id,
         l.attempts,
         l.leased_until,
         coalesce(
           (select jsonb_agg(jsonb_build_object(
             'kind', e.kind,
             'object_path', e.object_path,
             'sha256', e.sha256,
             'mime_type', e.mime_type,
             'byte_size', e.byte_size
           ) order by e.kind)
            from private.identity_verification_evidence e
            where e.session_id = l.session_id and e.state = 'uploaded'),
           '[]'::jsonb
         )
  from leased l;
end;
$$;

revoke all on function private.claim_identity_verification_job(text) from public, anon, authenticated;
grant execute on function private.claim_identity_verification_job(text) to service_role;
