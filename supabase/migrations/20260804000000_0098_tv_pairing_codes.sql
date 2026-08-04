-- ── TV Pairing Codes (migration 0098) ────────────────────────────────────────
-- Tabela de pareamento TV: fluxo device-code para autenticar a TV sem PKCE.
-- O browser da TV exibe um código; o usuário confirma no celular já logado.

create table if not exists tv_pairing_codes (
  id               uuid        not null default uuid_generate_v4() primary key,
  code             varchar(6)  not null,
  status           text        not null default 'pending',
  organization_id  uuid        references organizations(id) on delete cascade,
  user_id          uuid        references auth.users(id) on delete set null,
  access_token     uuid,
  expires_at       timestamptz not null,
  token_expires_at timestamptz,
  created_at       timestamptz not null default now(),

  constraint tv_pairing_codes_status_check check (status in ('pending', 'confirmed', 'expired'))
);

create index if not exists tv_pairing_codes_code_idx
  on tv_pairing_codes(code) where status = 'pending';

create index if not exists tv_pairing_codes_access_token_idx
  on tv_pairing_codes(access_token) where status = 'confirmed';
