-- Trigram indexes are only effective when LIKE patterns are visible at planning
-- time. PL/pgSQL may otherwise reuse a generic plan with parameterized '%term%'
-- predicates and fall back to full scans on every large search table.
alter function public.testagram_search_unified_uncached(text,text,integer,integer,text)
  set plan_cache_mode = 'force_custom_plan';
