UPDATE auth.identities
SET identity_data = jsonb_set(COALESCE(identity_data, '{}'::jsonb), '{email_verified}', 'true'::jsonb, true)
WHERE provider = 'email'
  AND COALESCE((identity_data->>'email_verified')::boolean, false) = false;

CREATE OR REPLACE FUNCTION public.auto_verify_email_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.provider = 'email' THEN
    NEW.identity_data := jsonb_set(COALESCE(NEW.identity_data, '{}'::jsonb), '{email_verified}', 'true'::jsonb, true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_verify_email_identity_trigger ON auth.identities;
CREATE TRIGGER auto_verify_email_identity_trigger
BEFORE INSERT OR UPDATE OF identity_data, provider ON auth.identities
FOR EACH ROW EXECUTE FUNCTION public.auto_verify_email_identity();