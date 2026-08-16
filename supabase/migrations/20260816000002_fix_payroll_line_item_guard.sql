-- ============================================================================
-- Fix Payroll Line Item Guard Tenant Mismatch False-Positive
-- 20260816000002_fix_payroll_line_item_guard.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION private.guard_payroll_line_item()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE
  run_row public.payroll_runs%ROWTYPE;
  employee_company uuid;
BEGIN
  SELECT * INTO run_row FROM public.payroll_runs WHERE id=coalesce(NEW.payroll_run_id,OLD.payroll_run_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found';
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') AND run_row.status IN ('completed','rejected','failed') THEN
    RAISE EXCEPTION 'Line items for terminal payroll runs are immutable';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT company_id INTO employee_company FROM public.employees WHERE id=NEW.employee_id;
    IF run_row.company_id IS DISTINCT FROM NEW.company_id OR (employee_company IS NOT NULL AND employee_company IS DISTINCT FROM NEW.company_id) THEN
      RAISE EXCEPTION 'Payroll line item tenant mismatch';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_payroll_line_item ON public.payroll_line_items;
CREATE TRIGGER guard_payroll_line_item BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_line_items
FOR EACH ROW EXECUTE FUNCTION private.guard_payroll_line_item();
