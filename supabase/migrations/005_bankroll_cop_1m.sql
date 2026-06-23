-- Bankroll inicial $1.000.000 COP; reset de apuestas previas

DELETE FROM public.user_bets;

ALTER TABLE public.profiles ALTER COLUMN bankroll SET DEFAULT 1000000;

UPDATE public.profiles SET bankroll = 1000000;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, bankroll)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    1000000
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
