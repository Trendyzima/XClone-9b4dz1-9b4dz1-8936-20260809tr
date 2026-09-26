-- Prevent role-controlled search_path resolution in the federation retention function.
alter function public.cleanup_federation_storage() set search_path = public;
