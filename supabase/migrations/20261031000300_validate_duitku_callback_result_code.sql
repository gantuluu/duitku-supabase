-- Enforce Duitku POP callback result-code/channel rules in the database
-- as defense in depth, and persist the callback payment method code.
-- POP Credit Card uses paymentCode VC.

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
  v_payment_code text;
  v_stored_reference text;
begin
  v_payment_code := pg_catalog.upper(
    coalesce(p_callback_payload ->> 'paymentCode', '')
  );

  if p_next_status is null then
    raise exception 'Invalid callback payment status';
  end if;

  if p_result_code = '00' then
    if p_next_status <> 'paid' then
      raise exception 'Invalid status for successful callback';
    end if;
  elsif p_result_code = '01' and v_payment_code = 'VC' then
    if p_next_status <> 'failed' then
      raise exception 'Invalid status for failed credit-card callback';
    end if;
  else
    raise exception 'Unsupported Duitku callback result code or payment channel';
  end if;

  select payment.id, payment.order_id, payment.amount, payment.status, payment.duitku_reference
    into v_payment_id, v_order_id, v_amount, v_status, v_stored_reference
  from public.duitku_payments as payment
  where payment.merchant_order_id = p_merchant_order_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_amount <> p_amount then
    return jsonb_build_object('outcome', 'amount_mismatch');
  end if;

  -- Both references must exist and match the invoice response saved at creation.
  -- A missing stored reference is not accepted as a valid callback association.
  if nullif(pg_catalog.btrim(coalesce(v_stored_reference, '')), '') is null
    or nullif(pg_catalog.btrim(coalesce(p_duitku_reference, '')), '') is null
    or v_stored_reference <> p_duitku_reference then
    return jsonb_build_object('outcome', 'reference_mismatch');
  end if;

  -- Paid is terminal. A later callback must not downgrade either row.
  if v_status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'status', 'paid');
  end if;

  update public.duitku_payments
  set
    status = p_next_status,
    payment_method = coalesce(nullif(v_payment_code, ''), payment_method),
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
