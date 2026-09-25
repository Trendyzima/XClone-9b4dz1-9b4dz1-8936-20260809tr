alter table public.federated_replies add column if not exists reply_object_uri text;
create unique index if not exists federated_replies_reply_object_uri_uidx on public.federated_replies(reply_object_uri) where reply_object_uri is not null;
create index if not exists federated_replies_parent_uri_idx on public.federated_replies(parent_uri);
