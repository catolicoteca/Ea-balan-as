-- ============================================================================
-- EA Balanças / Metrion — Ponto de Recuperação / Rollback da Migração 005
-- ============================================================================

BEGIN;

-- 1. Remove as funções introduzidas na migração 005
DROP FUNCTION IF EXISTS public.validate_invitation(uuid);
DROP FUNCTION IF EXISTS public.accept_company_invitation(uuid);
DROP FUNCTION IF EXISTS public.resend_company_invitation(uuid);

-- 2. Restaura o claim_pending_invitations original (se necessário reverter)
CREATE OR REPLACE FUNCTION public.claim_pending_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_inv record;
  v_claimed integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_inv IN
    SELECT *
      FROM public.company_invitations
     WHERE lower(email) = lower(v_email)
       AND status = 'pending'
  LOOP
    INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
    VALUES (v_inv.company_id, v_uid, v_inv.role, true, v_inv.invited_by)
    ON CONFLICT (company_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_active = true;

    UPDATE public.company_invitations
       SET status = 'accepted',
           accepted_by = v_uid,
           accepted_at = now()
     WHERE id = v_inv.id;

    v_claimed := v_claimed + 1;
  END LOOP;

  RETURN v_claimed;
END;
$$;

COMMIT;
