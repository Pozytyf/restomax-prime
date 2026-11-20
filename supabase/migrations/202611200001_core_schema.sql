-- ============================================================================
-- Migration: 202611200001_core_schema.sql
-- Description: Core multi-tenant Supabase schema for Resto'MAX
--   Tables: tenants, restaurants, roles, users, restaurant_members,
--           menu_categories, menu_items, dining_tables, orders, order_items
--   Includes: Foreign keys, RBAC role seeds, multi-tenant indexes,
--             sync/timestamp triggers, Row Level Security (RLS), and Realtime.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Tenants & Restaurants
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Abidjan',
  country TEXT NOT NULL DEFAULT 'Côte d''Ivoire',
  currency TEXT NOT NULL DEFAULT 'XOF',
  timezone TEXT NOT NULL DEFAULT 'Africa/Abidjan',
  tax_rate_percent DOUBLE PRECISION NOT NULL DEFAULT 18.0,
  service_fee_percent DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  opening_hours TEXT NOT NULL DEFAULT '08:00 - 23:30',
  paydunya_mode TEXT NOT NULL DEFAULT 'TEST',
  paydunya_public_key TEXT NOT NULL DEFAULT '',
  paydunya_private_key TEXT NOT NULL DEFAULT '',
  paydunya_token TEXT NOT NULL DEFAULT '',
  printer_settings_json TEXT NOT NULL DEFAULT '{"paperWidth":"80mm","connectionType":"BROWSER","printerHost":"","printerPort":9100,"autoPrintReceipt":false,"autoPrintKitchenTicket":false}',
  status TEXT NOT NULL DEFAULT 'TRIAL',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE IF NOT EXISTS public.restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Abidjan',
  country TEXT NOT NULL DEFAULT 'Côte d''Ivoire',
  currency TEXT NOT NULL DEFAULT 'XOF',
  timezone TEXT NOT NULL DEFAULT 'Africa/Abidjan',
  tax_rate_percent DOUBLE PRECISION NOT NULL DEFAULT 18.0,
  service_fee_percent DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  opening_hours TEXT NOT NULL DEFAULT '08:00 - 23:30',
  paydunya_mode TEXT NOT NULL DEFAULT 'TEST',
  paydunya_public_key TEXT NOT NULL DEFAULT '',
  paydunya_private_key TEXT NOT NULL DEFAULT '',
  paydunya_token TEXT NOT NULL DEFAULT '',
  printer_settings_json TEXT NOT NULL DEFAULT '{"paperWidth":"80mm","connectionType":"BROWSER","printerHost":"","printerPort":9100,"autoPrintReceipt":false,"autoPrintKitchenTicket":false}',
  status TEXT NOT NULL DEFAULT 'TRIAL',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- Keep public.tenants synchronized with public.restaurants
CREATE OR REPLACE FUNCTION public.sync_restaurant_to_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.tenants WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.tenants (
    id, name, slug, email, phone, address, city, country, currency, timezone,
    tax_rate_percent, service_fee_percent, opening_hours, paydunya_mode,
    paydunya_public_key, paydunya_private_key, paydunya_token,
    printer_settings_json, status, deleted_at, created_at
  ) VALUES (
    NEW.id, NEW.name, NEW.slug, NEW.email, NEW.phone, NEW.address, NEW.city, NEW.country, NEW.currency, NEW.timezone,
    NEW.tax_rate_percent, NEW.service_fee_percent, NEW.opening_hours, NEW.paydunya_mode,
    NEW.paydunya_public_key, NEW.paydunya_private_key, NEW.paydunya_token,
    NEW.printer_settings_json, NEW.status, NEW.deleted_at, NEW.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    city = EXCLUDED.city,
    country = EXCLUDED.country,
    currency = EXCLUDED.currency,
    timezone = EXCLUDED.timezone,
    tax_rate_percent = EXCLUDED.tax_rate_percent,
    service_fee_percent = EXCLUDED.service_fee_percent,
    opening_hours = EXCLUDED.opening_hours,
    paydunya_mode = EXCLUDED.paydunya_mode,
    paydunya_public_key = EXCLUDED.paydunya_public_key,
    paydunya_private_key = EXCLUDED.paydunya_private_key,
    paydunya_token = EXCLUDED.paydunya_token,
    printer_settings_json = EXCLUDED.printer_settings_json,
    status = EXCLUDED.status,
    deleted_at = EXCLUDED.deleted_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restaurants_sync_tenant ON public.restaurants;
CREATE TRIGGER trg_restaurants_sync_tenant
AFTER INSERT OR UPDATE OR DELETE ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.sync_restaurant_to_tenant();

-- ----------------------------------------------------------------------------
-- 2. Roles (RBAC catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_permissions_json TEXT NOT NULL DEFAULT '[]',
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

INSERT INTO public.roles (id, code, name, description, default_permissions_json, is_system)
VALUES
  (
    'role_super_admin',
    'SUPER_ADMIN',
    'Super Administrateur',
    'Accès global plateforme SaaS multi-tenant.',
    '["superadmin:all"]',
    TRUE
  ),
  (
    'role_owner',
    'OWNER',
    'Propriétaire',
    'Accès complet à son restaurant, facturation, équipe et paramètres.',
    '["dashboard:read","orders:read","orders:write","pos:use","pos:pay","pos:refund","floor:read","floor:write","kitchen:read","kitchen:write","menu:read","menu:write","stocks:read","stocks:write","staff:read","staff:manage","customers:read","customers:write","reservations:read","reservations:write","qr:read","qr:manage","finance:read","reports:read","settings:read","settings:write"]',
    TRUE
  ),
  (
    'role_manager',
    'MANAGER',
    'Gérant',
    'Pilotage opérationnel complet hors suppression d''établissement ou gestion globale propriétaire.',
    '["dashboard:read","orders:read","orders:write","pos:use","pos:pay","pos:refund","floor:read","floor:write","kitchen:read","kitchen:write","menu:read","menu:write","stocks:read","stocks:write","staff:read","customers:read","customers:write","reservations:read","reservations:write","qr:read","qr:manage","finance:read","reports:read","settings:read"]',
    TRUE
  ),
  (
    'role_cashier',
    'CASHIER',
    'Caissier',
    'Prise de commandes POS, encaissements et fidélité clients.',
    '["dashboard:read","orders:read","orders:write","pos:use","pos:pay","floor:read","menu:read","customers:read","customers:write"]',
    TRUE
  ),
  (
    'role_waiter',
    'WAITER',
    'Serveur',
    'Prise de commandes en salle, gestion des tables et réservations.',
    '["orders:read","orders:write","pos:use","floor:read","floor:write","menu:read","reservations:read","reservations:write","qr:read"]',
    TRUE
  ),
  (
    'role_kitchen_bar',
    'KITCHEN_BAR',
    'Cuisine & Bar',
    'Écran KDS, suivi préparation cuisine/bar et consultation stocks.',
    '["orders:read","kitchen:read","kitchen:write","menu:read","stocks:read"]',
    TRUE
  )
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Users & Restaurant Memberships
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'OWNER' REFERENCES public.roles(code) ON UPDATE CASCADE,
  global_role TEXT NOT NULL DEFAULT 'USER',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  token_version INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS public.restaurant_members (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL REFERENCES public.roles(code) ON UPDATE CASCADE,
  custom_permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE(restaurant_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 4. Menu Categories & Menu Items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_categories (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  station TEXT NOT NULL DEFAULT 'KITCHEN',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.menu_items (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES public.menu_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_xof INTEGER NOT NULL CHECK (price_xof >= 0),
  cost_price_xof INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_xof >= 0),
  image_url TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  options_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- ----------------------------------------------------------------------------
-- 5. Dining Tables, Orders & Order Items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dining_tables (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  zone TEXT NOT NULL DEFAULT 'Salle principale',
  label TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4 CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'AVAILABLE'
);

CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  order_type TEXT NOT NULL,
  table_id TEXT REFERENCES public.dining_tables(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT 'Client comptoir',
  status TEXT NOT NULL DEFAULT 'PENDING',
  subtotal_xof INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_xof >= 0),
  discount_xof INTEGER NOT NULL DEFAULT 0 CHECK (discount_xof >= 0),
  tax_xof INTEGER NOT NULL DEFAULT 0 CHECK (tax_xof >= 0),
  total_xof INTEGER NOT NULL DEFAULT 0 CHECK (total_xof >= 0),
  paid_xof INTEGER NOT NULL DEFAULT 0 CHECK (paid_xof >= 0),
  notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  created_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE(restaurant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  station TEXT NOT NULL DEFAULT 'KITCHEN',
  unit_price_xof INTEGER NOT NULL CHECK (unit_price_xof >= 0),
  options_summary TEXT NOT NULL DEFAULT '',
  options_delta_xof INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_xof INTEGER NOT NULL CHECK (line_total_xof >= 0),
  notes TEXT NOT NULL DEFAULT '',
  prep_status TEXT NOT NULL DEFAULT 'PENDING'
);

-- ----------------------------------------------------------------------------
-- 6. Automatic updated_at trigger on core mutable entities
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_iso_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_iso_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_iso_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Core Performance Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants(status);
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON public.restaurants(status);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON public.users(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_restaurant_members_restaurant ON public.restaurant_members(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON public.menu_categories(restaurant_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON public.menu_items(restaurant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_restaurant ON public.dining_tables(restaurant_id, zone);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_created ON public.orders(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON public.orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item ON public.order_items(menu_item_id);

-- ----------------------------------------------------------------------------
-- 8. Multi-Tenant Row Level Security (RLS)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(COALESCE(
    auth.jwt() ->> 'restaurant_id',
    auth.jwt() -> 'app_metadata' ->> 'restaurant_id',
    ''
  ), '');
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'global_role',
    auth.jwt() -> 'app_metadata' ->> 'global_role',
    ''
  ) = 'SUPER_ADMIN';
$$;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Roles catalog is readable by authenticated users
DROP POLICY IF EXISTS roles_read_authenticated ON public.roles;
CREATE POLICY roles_read_authenticated
ON public.roles FOR SELECT
TO authenticated
USING (TRUE);

-- Restaurants / Tenants scoped to active tenant or superadmin
DROP POLICY IF EXISTS tenant_self_access_restaurants ON public.restaurants;
CREATE POLICY tenant_self_access_restaurants
ON public.restaurants FOR ALL
USING (public.is_superadmin() OR id = public.current_tenant_id())
WITH CHECK (public.is_superadmin() OR id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_self_access_tenants ON public.tenants;
CREATE POLICY tenant_self_access_tenants
ON public.tenants FOR ALL
USING (public.is_superadmin() OR id = public.current_tenant_id())
WITH CHECK (public.is_superadmin() OR id = public.current_tenant_id());

-- Users scoped by tenant_id
DROP POLICY IF EXISTS tenant_isolation_users ON public.users;
CREATE POLICY tenant_isolation_users
ON public.users FOR ALL
USING (public.is_superadmin() OR tenant_id = public.current_tenant_id())
WITH CHECK (public.is_superadmin() OR tenant_id = public.current_tenant_id());

-- Restaurant-owned tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'restaurant_members',
    'menu_categories',
    'menu_items',
    'dining_tables',
    'orders'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%I ON public.%I FOR ALL USING (public.is_superadmin() OR restaurant_id = public.current_tenant_id()) WITH CHECK (public.is_superadmin() OR restaurant_id = public.current_tenant_id());',
      tbl,
      tbl
    );
  END LOOP;
END $$;

-- Order items scoped via parent order's restaurant_id
DROP POLICY IF EXISTS tenant_isolation_order_items ON public.order_items;
CREATE POLICY tenant_isolation_order_items
ON public.order_items FOR ALL
USING (
  public.is_superadmin()
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.restaurant_id = public.current_tenant_id()
  )
)
WITH CHECK (
  public.is_superadmin()
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.restaurant_id = public.current_tenant_id()
  )
);

-- ----------------------------------------------------------------------------
-- 9. Supabase Realtime Publication for core operational tables
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.dining_tables;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
