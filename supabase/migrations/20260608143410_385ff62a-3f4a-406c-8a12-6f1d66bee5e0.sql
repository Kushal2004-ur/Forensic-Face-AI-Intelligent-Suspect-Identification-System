ALTER TABLE public.cases
DROP CONSTRAINT IF EXISTS cases_created_by_fkey;

ALTER TABLE public.cases
ADD CONSTRAINT cases_created_by_fkey
FOREIGN KEY (created_by)
REFERENCES public.users(id)
ON DELETE RESTRICT;