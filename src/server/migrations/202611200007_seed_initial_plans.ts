import type { Knex } from 'knex';

// Synchronised with the existing SQLite demo catalog. Safe to run once on a
// freshly migrated PostgreSQL database; existing plans are never overwritten.
const plans = [
  {
    id: 'plan_essentiel',
    code: 'ESSENTIEL',
    name: 'Essentiel',
    tagline: 'Pour les maquis, cafés et petits restaurants en lancement',
    monthly: 25000,
    yearly: 250000,
    trial: 14,
    tables: 15,
    staff: 6,
    items: 80,
    featured: 0,
    features: [
      'Caisse POS tactile & reçus',
      'Gestion jusqu’à 15 tables',
      'Menu digital QR Code par table',
      'Suivi des commandes en temps réel',
      'Jusqu’à 6 comptes employés',
      'Support email en français',
    ],
  },
  {
    id: 'plan_pro',
    code: 'PROFESSIONNEL',
    name: 'Professionnel',
    tagline: 'Pour les restaurants structurés, lounges et brasseries',
    monthly: 55000,
    yearly: 550000,
    trial: 14,
    tables: 60,
    staff: 25,
    items: 350,
    featured: 1,
    features: [
      'Toutes les fonctions Essentiel',
      'Écrans KDS Cuisine & Bar séparés',
      'Gestion avancée des stocks & alertes',
      'Paiements partiels, partagés & Mobile Money (PayDunya)',
      'Fidélité clients & réservations',
      'Rapports financiers & marges FCFA',
    ],
  },
  {
    id: 'plan_premium',
    code: 'PREMIUM',
    name: 'Premium',
    tagline: 'Pour les groupes multi-sites et établissements à fort volume',
    monthly: 110000,
    yearly: 1100000,
    trial: 14,
    tables: 250,
    staff: 100,
    items: 1500,
    featured: 0,
    features: [
      'Toutes les fonctions Professionnel',
      'Tables, personnel & catalogue étendus',
      'Permissions granulaires personnalisées',
      'Exports comptables & audit sécurité complet',
      'Accompagnement déploiement prioritaire',
      'API & intégrations marchandes dédiées',
    ],
  },
];

export async function up(knex: Knex): Promise<void> {
  const createdAt = new Date().toISOString();
  for (const plan of plans) {
    await knex('plans')
      .insert({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        tagline: plan.tagline,
        price_monthly_xof: plan.monthly,
        price_yearly_xof: plan.yearly,
        trial_days: plan.trial,
        max_tables: plan.tables,
        max_staff: plan.staff,
        max_menu_items: plan.items,
        is_demo_pricing: 1,
        is_featured: plan.featured,
        features_json: JSON.stringify(plan.features),
        active: 1,
        created_at: createdAt,
      })
      .onConflict('code')
      .ignore();
  }
}

// Deliberately retain catalog rows on rollback: an administrator may have
// edited a seeded plan after deployment, and rollback must not erase that data.
export async function down(_knex: Knex): Promise<void> {}
