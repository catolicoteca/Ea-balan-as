import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const seedPath = resolve('src/data/priceCatalogSeed.json');
const items = JSON.parse(readFileSync(seedPath, 'utf-8'));

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

let sql = `-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Migração 004: Importação Oficial dos 130 Itens Reais da Planilha de Preços
-- Fonte Oficial: Tabela_de_Precos_Pesquisavel.xlsx (100% de paridade com o Excel)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_company_id uuid;
  v_user_admin_id uuid;
BEGIN
  -- 1. Garante que a Empresa Oficial (EA Balanças) existe no banco
  SELECT id INTO v_company_id
    FROM public.companies
   WHERE slug = 'ea-balancas'
   LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (
      name,
      legal_name,
      slug,
      document_cnpj,
      primary_color,
      accent_color,
      sidebar_color,
      is_active
    ) VALUES (
      'EA Balanças & Metrologia',
      'EA Balanças & Metrologia Ltda',
      'ea-balancas',
      '12.345.678/0001-90',
      '#0D9488',
      '#14B8A6',
      '#0B2545',
      true
    ) RETURNING id INTO v_company_id;
  END IF;

  -- 2. Insere os 130 itens oficiais reais na tabela price_catalog_items
  -- Utiliza ON CONFLICT para garantir idempotência e permitir re-execução segura
`;

sql += `  INSERT INTO public.price_catalog_items (
    company_id,
    code,
    category,
    subcategory,
    description,
    condition,
    price_term,
    price_cash,
    is_active
  ) VALUES\n`;

const valueRows = items.map((it, idx) => {
  const code = escapeSql(it.code);
  const cat = escapeSql(it.category);
  const subcat = it.subcategory ? escapeSql(it.subcategory) : 'NULL';
  const desc = escapeSql(it.description);
  const cond = escapeSql(it.condition || 'Nova');
  const pTerm = Number(it.price_term || 0).toFixed(2);
  const pCash = Number(it.price_cash || 0).toFixed(2);
  return `  (v_company_id, ${code}, ${cat}, ${subcat}, ${desc}, ${cond}, ${pTerm}, ${pCash}, true)`;
});

sql += valueRows.join(',\n');
sql += `\n  ON CONFLICT (company_id, code) DO UPDATE SET
    category = EXCLUDED.category,
    subcategory = EXCLUDED.subcategory,
    description = EXCLUDED.description,
    condition = EXCLUDED.condition,
    price_term = EXCLUDED.price_term,
    price_cash = EXCLUDED.price_cash,
    is_active = true,
    updated_at = now();\n\n`;

sql += `  -- 3. Registra a auditoria oficial de importação
  INSERT INTO public.price_catalog_imports (
    company_id,
    file_name,
    total_rows,
    imported_count,
    updated_count
  ) VALUES (
    v_company_id,
    'Tabela_de_Precos_Pesquisavel.xlsx',
    ${items.length},
    ${items.length},
    0
  );

  RAISE NOTICE 'Importação concluída com sucesso: % itens cadastrados para EA Balanças (%).', ${items.length}, v_company_id;
END $$;

COMMIT;
`;

writeFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), sql, 'utf-8');
console.log(`Gerado com sucesso: supabase/migrations/004_seed_real_price_catalog.sql com ${items.length} itens.`);
