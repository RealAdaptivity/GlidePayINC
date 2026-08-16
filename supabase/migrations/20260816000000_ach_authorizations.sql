CREATE TABLE IF NOT EXISTS public.ach_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    bank_account_last4 TEXT NOT NULL CHECK (char_length(bank_account_last4) = 4),
    bank_routing TEXT,
    agreement_version TEXT NOT NULL DEFAULT '2026-v1',
    consent_text TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ach_authorizations ENABLE ROW LEVEL SECURITY;

-- Admins can read company authorizations
DROP POLICY IF EXISTS ach_authorizations_admin_select ON public.ach_authorizations;
CREATE POLICY ach_authorizations_admin_select ON public.ach_authorizations
    FOR SELECT TO authenticated
    USING (private.is_company_admin(company_id));

-- Employees can read their own authorizations
DROP POLICY IF EXISTS ach_authorizations_employee_select ON public.ach_authorizations;
CREATE POLICY ach_authorizations_employee_select ON public.ach_authorizations
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR employee_id IN (
        SELECT id FROM public.employees WHERE user_id = auth.uid()
    ));

-- Employees and admins can insert authorizations
DROP POLICY IF EXISTS ach_authorizations_insert ON public.ach_authorizations;
CREATE POLICY ach_authorizations_insert ON public.ach_authorizations
    FOR INSERT TO authenticated
    WITH CHECK (
        (user_id = auth.uid() AND employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid() AND company_id = ach_authorizations.company_id))
        OR private.is_company_admin(company_id)
    );

CREATE INDEX IF NOT EXISTS idx_ach_authorizations_company_emp ON public.ach_authorizations(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_ach_authorizations_user ON public.ach_authorizations(user_id);
