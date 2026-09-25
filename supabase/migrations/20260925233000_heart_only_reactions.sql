-- Testagram now has one canonical reaction everywhere: ❤️ Like.
delete from public.post_reactions where emoji <> '❤️';
delete from public.federated_reactions where reaction_type is not null and reaction_type <> 'like';
alter table public.post_reactions drop constraint if exists post_reactions_emoji_check;
alter table public.post_reactions add constraint post_reactions_emoji_check check (emoji = '❤️');
