CREATE TYPE public.app_role AS ENUM ('admin', 'courier');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role public.app_role NOT NULL, UNIQUE(user_id, role));
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
CREATE POLICY roles_read ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE FUNCTION public.assign_verified_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) IN ('rafael2019rg@gmail.com', 'rodriguim.nascimento2@gmail.com') THEN
INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
END IF;
IF TG_OP = 'UPDATE' AND (NEW.email_confirmed_at IS NULL OR lower(NEW.email) NOT IN ('rafael2019rg@gmail.com', 'rodriguim.nascimento2@gmail.com')) THEN
DELETE FROM public.user_roles WHERE user_id = NEW.id AND role = 'admin';
END IF;
RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.assign_verified_admin() FROM PUBLIC;
CREATE TRIGGER rg2_verified_admin AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_verified_admin();
INSERT INTO public.user_roles(user_id, role) SELECT id, 'admin'::public.app_role FROM auth.users WHERE email_confirmed_at IS NOT NULL AND lower(email) IN ('rafael2019rg@gmail.com', 'rodriguim.nascimento2@gmail.com') ON CONFLICT DO NOTHING;
CREATE TABLE public.user_presence (user_id uuid PRIMARY KEY, last_seen timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY presence_read ON public.user_presence FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE FUNCTION public.touch_presence() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ INSERT INTO public.user_presence(user_id, last_seen) VALUES (auth.uid(), now()) ON CONFLICT(user_id) DO UPDATE SET last_seen = now() $$;
REVOKE ALL ON FUNCTION public.touch_presence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_presence() TO authenticated;
CREATE FUNCTION public.leave_presence() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ DELETE FROM public.user_presence WHERE user_id = auth.uid() $$;
REVOKE ALL ON FUNCTION public.leave_presence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_presence() TO authenticated;
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, phone text NOT NULL DEFAULT '', address text NOT NULL, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_admin ON public.clients FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TABLE public.user_locations (user_id uuid PRIMARY KEY, consent boolean NOT NULL DEFAULT false, latitude double precision, longitude double precision, accuracy double precision, updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT latitude_bounds CHECK (latitude BETWEEN -90 AND 90), CONSTRAINT longitude_bounds CHECK (longitude BETWEEN -180 AND 180), CONSTRAINT revoked_location CHECK (consent OR (latitude IS NULL AND longitude IS NULL AND accuracy IS NULL)));
GRANT SELECT ON public.user_locations TO authenticated;
GRANT ALL ON public.user_locations TO service_role;
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_read ON public.user_locations FOR SELECT TO authenticated USING (user_id = auth.uid() OR (consent AND public.has_role(auth.uid(), 'admin')));
CREATE FUNCTION public.set_location_consent(allowed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
INSERT INTO public.user_locations(user_id, consent) VALUES(auth.uid(), allowed) ON CONFLICT(user_id) DO UPDATE SET consent = allowed, latitude = NULL, longitude = NULL, accuracy = NULL, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.set_location_consent(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_location_consent(boolean) TO authenticated;
CREATE FUNCTION public.update_my_location(lat double precision, lng double precision, acc double precision) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
IF lat IS NULL OR lng IS NULL OR acc IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 OR acc < 0 THEN RAISE EXCEPTION 'Invalid location'; END IF;
UPDATE public.user_locations SET latitude = lat, longitude = lng, accuracy = acc, updated_at = now() WHERE user_id = auth.uid() AND consent;
IF NOT FOUND THEN RAISE EXCEPTION 'Location consent required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_my_location(double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_location(double precision, double precision, double precision) TO authenticated;
CREATE INDEX presence_last_seen_idx ON public.user_presence(last_seen);