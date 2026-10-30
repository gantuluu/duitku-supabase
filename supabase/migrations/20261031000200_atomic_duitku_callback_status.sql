-- Atomically apply a verified Duitku callback to payment and parent order.
-- The row lock serializes concurrent callbacks for the same merchant_order_id.

create or replace function public.apply_duitku_callback_status(
  p_merchant_order_id text,
  p_amount bigint,
  p_next_status text,
  p_result_code text,
  p_result_message text,
  p_callback_payload jsonb,
  p_duitku_reference text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_order_id uuid;
  v_amount bigint;
  v_status text;
begin
  if p_next_status not in ('paid', 'failed') then
    raise exception 'Invalid callback payment status';
  end if;

  select payment.id, payment.order_id, payment.amount, payment.status
    into v_payment_id, v_order_id, v_amount, v_status
  from public.duitku_payments as payment
  where payment.merchant_order_id = p_merchant_order_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_amount <> p_amount then
    return jsonb_build_object('outcome', 'amount_mismatch');
  end if;

  -- Paid is terminal. A later callback must not downgrade either row.
  if v_status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'status', 'paid');
  end if;

  update public.duitku_payments
  set
    status = p_next_status,
    result_code = p_result_code,
    result_message = coalesce(p_result_message, ''),
    callback_payload = p_callback_payload,
    duitku_reference = nullif(p_duitku_reference, ''),
    paid_at = case
      when p_next_status = 'paid' then pg_catalog.now()
      else null
    end,
    updated_at = pg_catalog.now()
  where id = v_payment_id;

  update public.duitku_payment_orders
  set
    payment_status = p_next_status,
    updated_at = pg_catalog.now()
  where id = v_order_id;

  return jsonb_build_object('outcome', 'updated', 'status', p_next_status);
end;
$$;

revoke all on function public.apply_duitku_callback_status(
  text, bigint, text, text, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.apply_duitku_callback_status(
  text, bigint, text, text, text, jsonb, text
) to service_role;
