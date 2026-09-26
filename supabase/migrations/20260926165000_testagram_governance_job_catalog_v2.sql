-- Expand the job catalog from the platform surfaces found during the governance audit.
insert into public.testagram_governance_roles(name,description,is_system_role) values
('community_admin','Community governance, membership and community operations',true),
('security_admin','Security controls, privileged access and security review',true),
('audit_admin','Read-only governance, financial and operational audit',true),
('release_ops','Release, deployment and production operations',true)
on conflict(name) do update set description=excluded.description,is_system_role=true;

insert into public.testagram_governance_role_permissions(role_id,permission_key)
select r.id,p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='community_admin' and p.key in ('governance.read','users.read','content.moderate')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id,permission_key)
select r.id,p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='security_admin' and p.key in ('governance.read','governance.audit.read','governance.admins.read','users.read','security.manage')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id,permission_key)
select r.id,p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='audit_admin' and p.key in ('governance.read','governance.admins.read','governance.audit.read','finance.read','system.read','users.read')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id,permission_key)
select r.id,p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='release_ops' and p.key in ('governance.read','system.read','system.manage','live.manage','fediverse.manage')
on conflict do nothing;
