-- Duitku integration tables.
-- These tables intentionally have no client-facing RLS policies.
-- Insert payment intents into duitku_payment_orders from a trusted backend only.

create extension if not exists pgcrypto;

create table if not exists public.duitku_payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  product_details text not null check (char_length(product_details) between 1 and 255),
  customer_email text not null,
  customer_name text,
  customer_phone text,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.duitku_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique
    references public.duitku_payment_orders(id) on delete restrict,
  merchant_order_id text not null unique,
  duitku_reference text unique,
  payment_url text,
  payment_method text,
  amount bigint not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  result_code text,
  result_message text,
  callback_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.duitku_callback_logs (
  id bigint generated always as identity primary key,
  merchant_order_id text,
  duitku_reference text,
  signature_valid boolean not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_duitku_payment_orders_user_id
  on public.duitku_payment_orders(user_id);

create index if not exists idx_duitku_payments_status
  on public.duitku_payments(status);

create index if not exists idx_duitku_callback_logs_order_id
  on public.duitku_callback_logs(merchant_order_id);

alter table public.duitku_payment_orders enable row level security;
alter table public.duitku_payments enable row level security;
alter table public.duitku_callback_logs enable row level security;

-- No anon/authenticated policies are created. Edge Functions access these
-- tables using the service-role key, which must remain server-side.
