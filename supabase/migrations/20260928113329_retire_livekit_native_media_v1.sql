-- Retire LiveKit as a media provider. Testagram's native Pion/WebRTC engine is authoritative.
alter table public.calls alter column provider set default 'testagram-native';
update public.calls set provider='testagram-native' where provider='livekit';

insert into public.capability_registry(name,version,access,readonly,enabled,description)
values
('testagram.calls.create',2,'authenticated',false,true,'Create a Testagram native WebRTC media call'),
('testagram.calls.join',2,'authenticated',false,true,'Join a Testagram native WebRTC media call'),
('testagram.calls.end',2,'authenticated',false,true,'End a Testagram native WebRTC media call'),
('testagram.calls.token',2,'authenticated',true,true,'Return the Testagram native media-engine connection contract')
on conflict(name) do update set version=excluded.version,description=excluded.description,enabled=true,updated_at=now();
