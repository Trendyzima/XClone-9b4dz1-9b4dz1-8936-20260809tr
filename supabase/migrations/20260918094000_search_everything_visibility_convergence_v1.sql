-- Route native post search through the canonical viewer visibility predicate.
create or replace function public.search_everything(p_query text, p_limit integer default 40)
returns table(kind text, id text, score real, title text, subtitle text, content text, url text, source text, created_at timestamptz, actor_uri text)
language sql
security definer
set search_path to 'public'
as $function$
with s as (
  select trim(regexp_replace(coalesce(p_query,''),'\\s+',' ','g')) q,
         least(greatest(coalesce(p_limit,40),1),80) lim
),
t as (
  select q,lim,case when q='' then null else websearch_to_tsquery('simple',q) end query from s
),
results as (
  select 'user'::text kind,p.id::text id,
    (coalesce(ts_rank_cd(to_tsvector('simple',coalesce(p.username,'')||' '||coalesce(p.display_name,'')||' '||coalesce(p.bio,'')),t.query),0)+case when lower(p.username)=lower(t.q) then 5 when lower(p.username) like lower(t.q)||'%' then 1 else 0 end)::real score,
    coalesce(nullif(p.display_name,''),p.username) title,'@'||p.username subtitle,coalesce(p.bio,'') content,null::text url,'testagram' source,p.created_at,null::text actor_uri
  from profiles p cross join t
  where t.q<>'' and (to_tsvector('simple',coalesce(p.username,'')||' '||coalesce(p.display_name,'')||' '||coalesce(p.bio,'')) @@ t.query or lower(p.username) like lower(t.q)||'%')
  union all
  select 'post',p.id::text,coalesce(ts_rank_cd(to_tsvector('simple',coalesce(p.content,p.body,'')),t.query),0)::real,
    coalesce(nullif(pr.display_name,''),pr.username,'Testagram'),
    case when pr.username is null then null else '@'||pr.username end,
    coalesce(p.content,p.body,''),null,'testagram',p.created_at,null
  from posts p cross join t
  left join profiles pr on pr.id=coalesce(p.author_id,p.user_id)
  where t.q<>''
    and public.testagram_post_is_visible_to_viewer(p.id,auth.uid())
    and to_tsvector('simple',coalesce(p.content,p.body,'')) @@ t.query
  union all
  select 'hashtag',h.id::text,(case when lower(h.tag)=lower(regexp_replace(t.q,'^#','')) then 5 else 1 end)::real,
    '#'||h.tag,coalesce(h.usage_count,h.post_count,0)::text||' posts',null,null,'testagram',h.last_used_at,null
  from hashtags h cross join t
  where t.q<>'' and lower(h.tag) like '%'||lower(regexp_replace(t.q,'^#',''))||'%'
  union all
  select 'community',c.id::text,coalesce(ts_rank_cd(to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.slug,'')||' '||coalesce(c.description,'')),t.query),0)::real,
    coalesce(c.display_name,c.name),c.slug,c.description,null,'testagram',c.created_at,null
  from communities c cross join t
  where t.q<>'' and not c.is_private and to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.slug,'')||' '||coalesce(c.description,'')) @@ t.query
  union all
  select 'fediverse_user',ra.id::text,
    (case when lower(coalesce(ra.username,''))=lower(t.q) then 5 when lower(coalesce(ra.username,'')) like lower(t.q)||'%' then 2 else 1 end)::real,
    coalesce(nullif(ra.actor->>'name',''),nullif(ra.actor->>'displayName',''),nullif(ra.username,''),ra.acct,'Fediverse user'),
    coalesce(ra.acct,case when ra.username is not null then '@'||ra.username||'@'||ra.domain end),
    coalesce(ra.actor->>'summary',ra.actor->>'bio',''),ra.actor_url,'fediverse',ra.updated_at,ra.actor_url
  from federation_remote_actors ra cross join t
  where t.q<>'' and (lower(coalesce(ra.username,'')) like '%'||lower(t.q)||'%' or lower(coalesce(ra.acct,'')) like '%'||lower(t.q)||'%' or lower(coalesce(ra.actor->>'name','')) like '%'||lower(t.q)||'%')
  union all
  select 'fediverse_user',a.id::text,
    (coalesce(ts_rank_cd(to_tsvector('simple',coalesce(a.preferred_username,'')||' '||coalesce(a.display_name,'')||' '||coalesce(a.summary,'')),t.query),0)+.25)::real,
    coalesce(nullif(a.display_name,''),a.preferred_username,'Fediverse user'),
    '@'||coalesce(a.preferred_username,'')||case when i.domain is null then '' else '@'||i.domain end,
    a.summary,a.uri,'fediverse',a.created_at,a.uri
  from federated_actors a cross join t left join federated_instances i on i.id=a.instance_id
  where t.q<>'' and a.discoverable and not a.suspended and to_tsvector('simple',coalesce(a.preferred_username,'')||' '||coalesce(a.display_name,'')||' '||coalesce(a.summary,'')) @@ t.query
  union all
  select 'fediverse_post',fo.id::text,1.0::real,
    coalesce(fo.object->>'name',fo.actor_url,'Fediverse post'),
    coalesce(new.url,'Fediverse'),coalesce(fo.object->>'content',fo.object->>'name',fo.object->>'summary',''),
    coalesce(fo.object->>'url',fo.object_url),'fediverse',coalesce(fo.published_at,(fo.object->>'published')::timestamptz),fo.actor_url
  from federation_objects fo cross join t
  left join lateral (select fo.object->>'url' url) new on true
  where t.q<>'' and lower(coalesce(fo.object->>'content','')||' '||coalesce(fo.object->>'summary','')||' '||coalesce(fo.object->>'name','')) like '%'||lower(t.q)||'%'
)
select * from results
where score>0
order by score desc,created_at desc nulls last
limit (select lim from s);
$function$;