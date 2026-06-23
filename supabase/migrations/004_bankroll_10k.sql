-- Bankroll inicial €10.000 para todas las cuentas (nuevas y existentes)

ALTER TABLE public.profiles ALTER COLUMN bankroll SET DEFAULT 10000;

UPDATE public.profiles SET bankroll = 10000;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, bankroll)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    10000
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
