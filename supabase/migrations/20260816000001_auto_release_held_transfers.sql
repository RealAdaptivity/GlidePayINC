-- Stored procedure to identify matured held transfers for automatic release
CREATE OR REPLACE FUNCTION public.release_eligible_held_transfers(p_company_id UUID DEFAULT NULL)
RETURNS TABLE (
    transfer_id UUID,
    payroll_run_id UUID,
    employee_id UUID,
    amount_cents BIGINT,
    released BOOLEAN,
    reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id AS transfer_id,
        t.payroll_run_id,
        t.employee_id,
        t.amount_cents,
        TRUE AS released,
        'Matured past 3-business-day hold'::TEXT AS reason
    FROM public.ach_transfers t
    JOIN public.employees e ON e.id = t.employee_id
    WHERE t.status = 'held'
      AND (p_company_id IS NULL OR t.company_id = p_company_id)
      AND e.bank_account_linked_at IS NOT NULL
      AND e.bank_account_linked_at <= (now() - INTERVAL '3 days');
END;
$$;

REVOKE ALL ON FUNCTION public.release_eligible_held_transfers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_eligible_held_transfers(UUID) TO authenticated;
