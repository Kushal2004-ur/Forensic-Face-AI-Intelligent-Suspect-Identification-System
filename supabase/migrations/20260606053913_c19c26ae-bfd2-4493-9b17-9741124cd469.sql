INSERT INTO public.users (id, email, name, role)
SELECT
  au.id,
  au.email,
  COALESCE(
    au.raw_user_meta_data->>'name',
    au.raw_user_meta_data->>'full_name',
    split_part(au.email, '@', 1)
  ) AS name,
  'officer' AS role
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
  AND au.email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.users WHERE id = auth.uid()),
    CASE WHEN auth.uid() IS NOT NULL THEN 'officer' ELSE NULL END
  );
$$;

ALTER TABLE public.cases
ALTER COLUMN created_by SET NOT NULL;

DROP POLICY IF EXISTS "Officers can create cases" ON public.cases;
CREATE POLICY "Officers can create cases"
ON public.cases
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by AND public.is_officer_or_above());