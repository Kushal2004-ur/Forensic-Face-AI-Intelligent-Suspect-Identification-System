-- 1. Confirm existing unconfirmed users
UPDATE auth.users
SET email_confirmed_at = now()
WHERE email_confirmed_at IS NULL;

-- 2. Backfill public.users rows
INSERT INTO public.users (id, email, name, role)
SELECT u.id,
       u.email,
       COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
       'officer'
FROM auth.users u
LEFT JOIN public.users pu ON pu.id = u.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 3. Attach signup trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();