-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Migração 005: Sistema Seguro de Convites, Links de Ativação e Gestão de Técnicos
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. FUNÇÃO: Validar Convite com Segurança (Pública para ativação / anon)
-- ----------------------------------------------------------------------------
-- Finalidade: Permite que a tela pública /ativar verifique a autenticidade
-- do convite antes de solicitar a definição de senha ao técnico.
-- Retorna apenas campos públicos e estritamente necessários para exibição.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv record;
  v_is_expired boolean;
BEGIN
  SELECT ci.*, c.name as company_name
    INTO v_inv
    FROM public.company_invitations ci
    JOIN public.companies c ON c.id = ci.company_id
   WHERE ci.id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'Convite não encontrado ou inválido.'
    );
  END IF;

  -- Convite expira após 7 dias de sua emissão/reenvio
  v_is_expired := (v_inv.created_at < (now() - interval '7 days'));

  IF v_inv.status = 'revoked' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'Este convite foi revogado pela administração da empresa.'
    );
  END IF;

  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'already_accepted', true,
      'email', v_inv.email,
      'company_name', v_inv.company_name,
      'reason', 'Este convite já foi aceito anteriormente. Você pode entrar diretamente com seu e-mail e senha.'
    );
  END IF;

  IF v_is_expired THEN
    RETURN jsonb_build_object(
      'valid', false,
      'expired', true,
      'email', v_inv.email,
      'company_name', v_inv.company_name,
      'reason', 'Este convite expirou (validade de 7 dias). Solicite ao gestor o reenvio pelo painel.'
    );
  END IF;

  -- Convite válido e pendente
  RETURN jsonb_build_object(
    'valid', true,
    'invitation_id', v_inv.id,
    'email', v_inv.email,
    'full_name', v_inv.full_name,
    'company_name', v_inv.company_name,
    'role', v_inv.role,
    'created_at', v_inv.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invitation(uuid) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. FUNÇÃO: Aceitar Convite com Validação Forte no Servidor
-- ----------------------------------------------------------------------------
-- Finalidade: Executada após o técnico se autenticar (cadastro ou login).
-- Garante vínculo compulsório à empresa e ao papel do convite, impedindo
-- usurpação por terceiros ou escalada de privilégios.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_company_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_user_rec record;
  v_inv record;
  v_is_expired boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Acesso não autenticado. Faça login para aceitar o convite.';
  END IF;

  SELECT email, email_confirmed_at, confirmed_at
    INTO v_user_rec
    FROM auth.users
   WHERE id = v_uid;

  IF v_user_rec.email IS NULL THEN
    RAISE EXCEPTION 'Usuário não possui e-mail cadastrado.';
  END IF;

  -- 1. Validação estrita de confirmação de e-mail no Supabase Auth
  IF (v_user_rec.email_confirmed_at IS NULL AND v_user_rec.confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'O e-mail (%) ainda não foi confirmado. Confirme seu e-mail antes de ativar o convite.',
      v_user_rec.email;
  END IF;

  SELECT * INTO v_inv
    FROM public.company_invitations
   WHERE id = p_invitation_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  -- 1. Validação estrita de identidade: o e-mail autenticado DEVE corresponder ao e-mail do convite
  IF lower(btrim(v_inv.email)) != lower(btrim(v_user_rec.email)) THEN
    RAISE EXCEPTION 'O e-mail da sua conta (%) não corresponde ao e-mail deste convite (%).',
      v_user_rec.email, v_inv.email;
  END IF;

  -- 2. Validação de expiração (7 dias)
  v_is_expired := (v_inv.created_at < (now() - interval '7 days'));
  IF v_is_expired THEN
    RAISE EXCEPTION 'Este convite expirou. Solicite ao gestor o reenvio.';
  END IF;

  -- 3. Validação de revogação
  IF v_inv.status = 'revoked' THEN
    RAISE EXCEPTION 'Este convite foi revogado pela administração.';
  END IF;

  -- 4. Idempotência: se já foi aceito pelo próprio usuário, retorna sucesso
  IF v_inv.status = 'accepted' THEN
    IF v_inv.accepted_by = v_uid THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_accepted', true,
        'company_id', v_inv.company_id,
        'role', v_inv.role
      );
    ELSE
      RAISE EXCEPTION 'Este convite já foi aceito anteriormente por outro usuário.';
    END IF;
  END IF;

  -- 5. Cria ou atualiza a afiliação na empresa estritamente com o papel autorizado pelo convite
  INSERT INTO public.company_memberships (
    company_id, user_id, role, is_active, invited_by
  ) VALUES (
    v_inv.company_id, v_uid, v_inv.role, true, v_inv.invited_by
  )
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        is_active = true;

  -- 6. Se houver vínculo de técnico cadastrado, vincula user_id na tabela technicians
  IF v_inv.technician_id IS NOT NULL THEN
    UPDATE public.technicians
       SET user_id = v_uid,
           is_active = true
     WHERE id = v_inv.technician_id
       AND company_id = v_inv.company_id;
  ELSIF v_inv.role = 'technician' THEN
    UPDATE public.technicians
       SET user_id = v_uid,
           is_active = true
     WHERE company_id = v_inv.company_id
       AND lower(email) = lower(v_user_rec.email)
       AND (user_id IS NULL OR user_id = v_uid);
  END IF;

  -- 7. Atualiza perfil do usuário com default_company_id
  UPDATE public.profiles
     SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
   WHERE id = v_uid;

  -- 8. Marca o convite como aceito compulsoriamente
  UPDATE public.company_invitations
     SET status = 'accepted',
         accepted_by = v_uid,
         accepted_at = now()
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_inv.company_id,
    'role', v_inv.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_company_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. FUNÇÃO: Reenviar Convite (Exclusivo para Gestores da Empresa)
-- ----------------------------------------------------------------------------
-- Finalidade: Permite ao gestor renovar a validade por mais 7 dias de um
-- convite pendente ou expirado. Bloqueia acesso cruzado entre empresas.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resend_company_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv record;
  v_is_mgr boolean;
BEGIN
  SELECT * INTO v_inv
    FROM public.company_invitations
   WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  -- Validação de segurança: apenas gestor da empresa do convite pode renovar/reenviar
  v_is_mgr := public.is_company_manager(v_inv.company_id);
  IF NOT v_is_mgr THEN
    RAISE EXCEPTION 'Apenas gestores da empresa têm permissão para reenviar convites.';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'Este convite já foi aceito e o técnico já está vinculado à empresa.';
  END IF;

  -- Renova a validade para mais 7 dias a partir de agora
  UPDATE public.company_invitations
     SET created_at = now(),
         status = 'pending',
         invited_by = auth.uid()
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_inv.id,
    'email', v_inv.email,
    'created_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resend_company_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resend_company_invitation(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. ATUALIZAÇÃO: handle_new_auth_user
-- ----------------------------------------------------------------------------
-- Regras Fundamentais:
-- 1. Se a confirmação de e-mail estiver ativada no Supabase e o e-mail NÃO
--    estiver confirmado (email_confirmed_at IS NULL), o convite é PRESERVADO
--    como 'pending' até o retorno autenticado do técnico.
-- 2. Nunca aceita convites expirados (> 7 dias).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name text;
  v_inv record;
  v_is_confirmed boolean;
BEGIN
  v_full_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(COALESCE(NEW.email, ''), '@', 1)
  );

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE
          WHEN btrim(public.profiles.full_name) = '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END;

  -- Verifica se a conta já possui e-mail confirmado
  v_is_confirmed := (NEW.email_confirmed_at IS NOT NULL OR NEW.confirmed_at IS NOT NULL);

  -- Se a confirmação de e-mail for exigida e ainda não foi confirmada,
  -- PRESERVA o convite como 'pending' para que seja reivindicado apenas após validação real.
  IF NEW.email IS NOT NULL AND v_is_confirmed THEN
    -- Vincula apenas convites pendentes e NÃO expirados (7 dias)
    FOR v_inv IN
      SELECT *
        FROM public.company_invitations
       WHERE lower(email) = lower(NEW.email)
         AND status = 'pending'
         AND created_at >= (now() - interval '7 days')
    LOOP
      INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
      VALUES (v_inv.company_id, NEW.id, v_inv.role, true, v_inv.invited_by)
      ON CONFLICT (company_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            is_active = true;

      IF v_inv.technician_id IS NOT NULL THEN
        UPDATE public.technicians
           SET user_id = NEW.id
         WHERE id = v_inv.technician_id
           AND company_id = v_inv.company_id
           AND user_id IS NULL;
      ELSIF v_inv.role = 'technician' THEN
        UPDATE public.technicians
           SET user_id = NEW.id
         WHERE company_id = v_inv.company_id
           AND lower(email) = lower(NEW.email)
           AND user_id IS NULL;
      END IF;

      UPDATE public.company_invitations
         SET status = 'accepted',
             accepted_by = NEW.id,
             accepted_at = now()
       WHERE id = v_inv.id;

      UPDATE public.profiles
         SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
       WHERE id = NEW.id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. ATUALIZAÇÃO: claim_pending_invitations (Executada no login autenticado)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_user_rec record;
  v_inv record;
  v_claimed integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT email, email_confirmed_at, confirmed_at
    INTO v_user_rec
    FROM auth.users
   WHERE id = v_uid;

  IF v_user_rec.email IS NULL THEN
    RETURN 0;
  END IF;

  -- Se o e-mail não estiver confirmado, não reivindica nenhum convite
  IF (v_user_rec.email_confirmed_at IS NULL AND v_user_rec.confirmed_at IS NULL) THEN
    RETURN 0;
  END IF;

  -- Reivindica somente convites pendentes com menos de 7 dias
  FOR v_inv IN
    SELECT *
      FROM public.company_invitations
     WHERE lower(email) = lower(v_user_rec.email)
       AND status = 'pending'
       AND created_at >= (now() - interval '7 days')
  LOOP
    INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
    VALUES (v_inv.company_id, v_uid, v_inv.role, true, v_inv.invited_by)
    ON CONFLICT (company_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_active = true;

    IF v_inv.technician_id IS NOT NULL THEN
      UPDATE public.technicians
         SET user_id = v_uid
       WHERE id = v_inv.technician_id
         AND company_id = v_inv.company_id
         AND (user_id IS NULL OR user_id = v_uid);
    ELSIF v_inv.role = 'technician' THEN
      UPDATE public.technicians
         SET user_id = v_uid
       WHERE company_id = v_inv.company_id
         AND lower(email) = lower(v_email)
         AND (user_id IS NULL OR user_id = v_uid);
    END IF;

    UPDATE public.company_invitations
       SET status = 'accepted',
           accepted_by = v_uid,
           accepted_at = now()
     WHERE id = v_inv.id;

    UPDATE public.profiles
       SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
     WHERE id = v_uid;

    v_claimed := v_claimed + 1;
  END LOOP;

  RETURN v_claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_invitations() TO authenticated;

COMMIT;
