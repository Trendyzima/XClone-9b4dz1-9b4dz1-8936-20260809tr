-- Owner-scoped profile editing contract.
create or replace function public.profile_update(p_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_profile public.profiles%rowtype;
  v_username text;
begin
  if v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if jsonb_typeof(p_input)<>'object' then raise exception using errcode='22023',message='Profile input must be an object'; end if;
  if not exists(select 1 from public.profiles where id=v_user_id) then raise exception using errcode='P0002',message='Profile not found'; end if;
  if p_input ? 'username' then
    v_username:=lower(btrim(p_input->>'username'));
    if v_username='' or length(v_username)>30 or v_username !~ '^[a-z0-9_][a-z0-9_.-]{1,29}$' then raise exception using errcode='22023',message='Invalid username'; end if;
  end if;
  if p_input ? 'display_name' and length(coalesce(p_input->>'display_name',''))>80 then raise exception using errcode='22023',message='Display name is too long'; end if;
  if p_input ? 'bio' and length(coalesce(p_input->>'bio',''))>500 then raise exception using errcode='22023',message='Bio is too long'; end if;
  if p_input ? 'website_url' and length(coalesce(p_input->>'website_url',''))>500 then raise exception using errcode='22023',message='Website URL is too long'; end if;
  if p_input ? 'location' and length(coalesce(p_input->>'location',''))>120 then raise exception using errcode='22023',message='Location is too long'; end if;
  if p_input ? 'pronouns' and length(coalesce(p_input->>'pronouns',''))>80 then raise exception using errcode='22023',message='Pronouns are too long'; end if;
  if p_input ? 'birth_date' then
    if nullif(btrim(p_input->>'birth_date'),'') is not null then
      begin
        perform (p_input->>'birth_date')::date;
      exception when others then
        raise exception using errcode='22023',message='Invalid birth date';
      end;
    end if;
  end if;
  if p_input ? 'avatar_url' and length(coalesce(p_input->>'avatar_url',''))>2000 then raise exception using errcode='22023',message='Avatar URL is too long'; end if;
  if p_input ? 'cover_url' and length(coalesce(p_input->>'cover_url',''))>2000 then raise exception using errcode='22023',message='Cover URL is too long'; end if;
  if p_input ? 'social_links' and jsonb_typeof(p_input->'social_links')<>'object' then raise exception using errcode='22023',message='social_links must be an object'; end if;
  if p_input ? 'profile_features' and jsonb_typeof(p_input->'profile_features')<>'object' then raise exception using errcode='22023',message='profile_features must be an object'; end if;
  if p_input ? 'appearance_settings' and jsonb_typeof(p_input->'appearance_settings')<>'object' then raise exception using errcode='22023',message='appearance_settings must be an object'; end if;
  update public.profiles set
    username=case when p_input ? 'username' then v_username else username end,
    display_name=case when p_input ? 'display_name' then nullif(btrim(p_input->>'display_name'),'') else display_name end,
    avatar_url=case when p_input ? 'avatar_url' then nullif(btrim(p_input->>'avatar_url'),'') else avatar_url end,
    cover_url=case when p_input ? 'cover_url' then nullif(btrim(p_input->>'cover_url'),'') else cover_url end,
    bio=case when p_input ? 'bio' then nullif(btrim(p_input->>'bio'),'') else bio end,
    website_url=case when p_input ? 'website_url' then nullif(btrim(p_input->>'website_url'),'') else website_url end,
    location=case when p_input ? 'location' then nullif(btrim(p_input->>'location'),'') else location end,
    social_links=case when p_input ? 'social_links' then p_input->'social_links' else social_links end,
    pronouns=case when p_input ? 'pronouns' then nullif(btrim(p_input->>'pronouns'),'') else pronouns end,
    birth_date=case when p_input ? 'birth_date' then nullif(btrim(p_input->>'birth_date'),'')::date else birth_date end,
    profile_features=case when p_input ? 'profile_features' then p_input->'profile_features' else profile_features end,
    appearance_settings=case when p_input ? 'appearance_settings' then p_input->'appearance_settings' else appearance_settings end,
    updated_at=now()
  where id=v_user_id
  returning * into v_profile;
  return jsonb_build_object('profile',to_jsonb(v_profile),'updated',true);
end;
$$;

revoke all on function public.profile_update(jsonb) from public, anon;
grant execute on function public.profile_update(jsonb) to authenticated;

insert into public.capability_registry(name,version,access,readonly,enabled,description)
values('testagram.profile.update',1,'authenticated',false,true,'Update owner-controlled profile fields')
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,enabled=excluded.enabled,description=excluded.description,updated_at=now();