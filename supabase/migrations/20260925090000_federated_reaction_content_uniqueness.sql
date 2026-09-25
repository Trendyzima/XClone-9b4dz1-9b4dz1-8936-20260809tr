alter table public.federated_reactions
  drop constraint if exists federated_reactions_user_id_object_uri_reaction_type_key;

alter table public.federated_reactions
  add constraint federated_reactions_user_object_reaction_content_key
  unique (user_id, object_uri, reaction_type, content);
