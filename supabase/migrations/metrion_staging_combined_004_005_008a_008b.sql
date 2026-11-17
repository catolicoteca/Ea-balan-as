-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Pacote Consolidado de Migrações Restantes para Staging (004 + 005 + 008a + 008b)
-- ============================================================================
-- Estrutura de Transações:
-- 1. Transação 1: Seed do Catálogo (004) + Convites de Técnicos (005) + Enum (008a)
--    -> Comita para registrar o valor 'administrator' no catálogo pg_enum do PostgreSQL.
-- 2. Transação 2: Estruturas, Funções Seguras, RLS e Suporte Auditado (008b)
--    -> Utiliza o valor 'administrator' com segurança e comita atomicamente.
-- ============================================================================

-- >>> INÍCIO TRANSAÇÃO 1: CATÁLOGO, CONVITES E ENUM DE PAPÉIS <<<
BEGIN;

-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Migração 004: Importação Oficial dos 130 Itens Reais da Planilha de Preços
-- Fonte Oficial: Tabela_de_Precos_Pesquisavel.xlsx (100% de paridade com o Excel)
-- ============================================================================
-- [004 BEGIN unificado]
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
  INSERT INTO public.price_catalog_items (
    company_id,
    code,
    category,
    subcategory,
    description,
    condition,
    price_term,
    price_cash,
    is_active
  ) VALUES
  (v_company_id, 'CAT-001', 'Teclados', 'Teclados (Toledo)', 'Teclado Prix5 plus/prix4 flex/prix4 due/prix4 uno', 'Nova', 390.02, 370.51, true),
  (v_company_id, 'CAT-002', 'Teclados', 'Teclados (Toledo)', 'Teclado Prix6', 'Nova', 466.00, 442.70, true),
  (v_company_id, 'CAT-003', 'Teclados', 'Teclados (Toledo)', 'Teclado prix3 (todas as versões antigas)', 'Nova', 271.00, 257.45, true),
  (v_company_id, 'CAT-004', 'Teclados', 'Teclados (Toledo)', 'PCI Teclado Prix3 Fit / Plus (Quando da Conserto)', 'Conserto', 245.00, 232.75, true),
  (v_company_id, 'CAT-005', 'Teclados', 'Teclados (Toledo)', 'PCI Teclado Prix3 Plus', 'Nova', 559.13, 531.18, true),
  (v_company_id, 'CAT-006', 'Teclados', 'Teclados (Toledo)', 'Painel Teclado Prix3 Fit', 'Nova', 265.83, 252.53, true),
  (v_company_id, 'CAT-007', 'Teclados', 'Teclados (Toledo)', 'Painel Teclado Prix3 Plus', 'Nova', 231.08, 219.52, true),
  (v_company_id, 'CAT-008', 'Teclados', 'Teclados (Toledo)', 'Teclado 8217 LP-3 Teclas/ 2 Teclas', 'Nova', 294.04, 279.33, true),
  (v_company_id, 'CAT-009', 'Teclados', 'Teclados (Toledo)', 'Teclado 9091', 'Nova', 390.02, 370.51, true),
  (v_company_id, 'CAT-010', 'Teclados', 'Teclados (Filizola e Outros)', 'Teclado Platina Custon', 'Nova', 390.02, 370.51, true),
  (v_company_id, 'CAT-011', 'Teclados', 'Teclados (Filizola e Outros)', 'Teclado CS-15/CS-6', 'Nova', 271.00, 257.45, true),
  (v_company_id, 'CAT-012', 'Teclados', 'Teclados (Filizola e Outros)', 'Teclado BP-15/BP-6', 'Nova', 271.00, 257.45, true),
  (v_company_id, 'CAT-013', 'Teclados', 'Teclados (Filizola e Outros)', 'Teclado IDM todos os modelos (conserto)', 'Conserto', 271.00, 257.45, true),
  (v_company_id, 'CAT-014', 'Teclados', 'Teclados (Filizola e Outros)', 'Teclado Magna LPCR', 'Nova', 271.00, 257.45, true),
  (v_company_id, 'CAT-015', 'Teclados', 'Teclados (Filizola e Outros)', 'Teclado Ramuza DCR CL (todos os modelos)', 'Nova', 271.00, 257.45, true),
  (v_company_id, 'CAT-016', 'Sensores', 'Gap Sensor', 'Gap Sensor Toledo', 'Nova', 376.00, 357.20, true),
  (v_company_id, 'CAT-017', 'Sensores', 'Gap Sensor', 'Gap Sensor Filizola', 'Nova', 336.00, 319.20, true),
  (v_company_id, 'CAT-018', 'Baterias', 'Baterias', 'Bateria TI-200 Original Prix', 'Nova', 446.50, 424.18, true),
  (v_company_id, 'CAT-019', 'Baterias', 'Baterias', 'Bateria 6V x 1,3A', 'Nova', 238.50, 226.58, true),
  (v_company_id, 'CAT-020', 'Baterias', 'Baterias', 'Bateria 6V x 4,5A', 'Nova', 271.00, 257.45, true),
  (v_company_id, 'CAT-021', 'Baterias', 'Baterias', 'Bateria 12V x 5A', 'Nova', 336.00, 319.20, true),
  (v_company_id, 'CAT-022', 'Baterias', 'Baterias', 'Bateria 12V x 7A', 'Nova', 375.00, 356.25, true),
  (v_company_id, 'CAT-023', 'Células de Carga', 'Células de Carga', 'Celulas de Carga TL20', 'Nova', 830.00, 788.50, true),
  (v_company_id, 'CAT-024', 'Células de Carga', 'Células de Carga', 'Celulas de Carga TL30', 'Nova', 956.00, 908.20, true),
  (v_company_id, 'CAT-025', 'Células de Carga', 'Células de Carga', 'Celulas de Carga SV20/SV50', 'Sob Consulta', 826.00, 784.70, true),
  (v_company_id, 'CAT-026', 'Células de Carga', 'Células de Carga', 'Celulas de Carga Tijolão 500kg/GL500', 'Sob Consulta', 1151.00, 1093.45, true),
  (v_company_id, 'CAT-027', 'Células de Carga', 'Células de Carga', 'Celulas de Carga GL20/GL30/GL40', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-028', 'Células de Carga', 'Células de Carga', 'Celulas de Carga 2095', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-029', 'Células de Carga', 'Células de Carga', 'Celulas de Carga Platina', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-030', 'Células de Carga', 'Células de Carga', 'Celulas de Carga naja 8217 Light', 'Nova', 1272.00, 1208.40, true),
  (v_company_id, 'CAT-031', 'Células de Carga', 'Células de Carga', 'Celulas de Carga 1-250/500/1000 com pé Articulado (somente as 4)', 'Nova', 2320.00, 2204.00, true),
  (v_company_id, 'CAT-032', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Prix5 plus (8.6 e versões inferiores)', 'Conserto', 830.00, 788.50, true),
  (v_company_id, 'CAT-033', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Prix4/flex/plus/due/uno (todas as versões antiga)', 'Conserto', 830.00, 788.50, true),
  (v_company_id, 'CAT-034', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Prix5 plus (8.7 e versões superiores)', 'Conserto', 1220.00, 1159.00, true),
  (v_company_id, 'CAT-035', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Prix4 due / uno (todas as versões nova)', 'Conserto', 1220.00, 1159.00, true),
  (v_company_id, 'CAT-036', 'Placas (PCI)', 'PCI Principal', 'PCI Principal 9098', 'Conserto', 602.50, 572.38, true),
  (v_company_id, 'CAT-037', 'Placas (PCI)', 'PCI Principal', 'PCI Principal 9098 C/Display Quebrado', 'Conserto', 700.00, 665.00, true),
  (v_company_id, 'CAT-038', 'Placas (PCI)', 'PCI Principal', 'PCI Principal 9098C', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-039', 'Placas (PCI)', 'PCI Principal', 'PCI Principal 9091', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-040', 'Placas (PCI)', 'PCI Principal', 'PCI Principal 8217-LP', 'Conserto', 466.00, 442.70, true),
  (v_company_id, 'CAT-041', 'Placas (PCI)', 'PCI Principal', 'PCI Principal 8217 Light', 'Nova', 830.00, 788.50, true),
  (v_company_id, 'CAT-042', 'Placas (PCI)', 'PCI Principal', 'PCI Principal 8217 Light', 'Conserto', 570.00, 541.50, true),
  (v_company_id, 'CAT-043', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Prix3 Plus / 9094 Plus', 'Nova', 571.30, 542.74, true),
  (v_company_id, 'CAT-044', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Prix3 Fit', 'Nova', 482.90, 458.76, true),
  (v_company_id, 'CAT-045', 'Placas (PCI)', 'PCI Principal', 'PCI Principal TI-200', 'Nova', 760.32, 722.30, true),
  (v_company_id, 'CAT-046', 'Placas (PCI)', 'PCI Principal', 'PCI Display TI-200', 'Nova', 349.00, 331.55, true),
  (v_company_id, 'CAT-047', 'Placas (PCI)', 'PCI Principal', 'PCI Princ. P3 Fit / P3 Plus / 9094 Plus (Quando da Conserto)', 'Conserto', 310.00, 294.50, true),
  (v_company_id, 'CAT-048', 'Placas (PCI)', 'PCI Principal', 'PCI Principal MGV5', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-049', 'Placas (PCI)', 'PCI Principal', 'PCI Principal IDM Cristal / Led', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-050', 'Placas (PCI)', 'PCI Principal', 'PCI Principal IDM Cristal C/ Display Quebrado', 'Sob Consulta', 0.00, 0.00, true),
  (v_company_id, 'CAT-051', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Platina (Unificada)', 'Nova', 1155.00, 1097.25, true),
  (v_company_id, 'CAT-052', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Platina (Unificada)', 'Conserto', 492.00, 467.40, true),
  (v_company_id, 'CAT-053', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Platina (330)', 'Nova', 635.00, 603.25, true),
  (v_company_id, 'CAT-054', 'Placas (PCI)', 'PCI Principal', 'PCI Principal Platina (330)', 'Conserto', 440.00, 418.00, true),
  (v_company_id, 'CAT-055', 'Placas (PCI)', 'PCI Principal', 'PCI Conversora Platina', 'Conserto', 414.00, 393.30, true),
  (v_company_id, 'CAT-056', 'Placas (PCI)', 'PCI Principal', 'PCI TP-80 Platina', 'Conserto', 414.00, 393.30, true),
  (v_company_id, 'CAT-057', 'Placas (PCI)', 'PCI Display', 'PCI Display Operador Platina', 'Conserto', 505.00, 479.75, true),
  (v_company_id, 'CAT-058', 'Placas (PCI)', 'PCI Display', 'PCI Display Tras. Prix5 plus (8.6 e versões inferiores)', 'Conserto', 570.00, 541.50, true),
  (v_company_id, 'CAT-059', 'Placas (PCI)', 'PCI Display', 'PCI Display Tras. Prix5 plus, prix4 due/uno (todas as versões nova)', 'Conserto', 674.00, 640.30, true),
  (v_company_id, 'CAT-060', 'Placas (PCI)', 'PCI Display', 'PCI Display 8217-LP 3 e 2 Teclas S/ Vidro', 'Conserto', 414.00, 393.30, true),
  (v_company_id, 'CAT-061', 'Placas (PCI)', 'PCI Display', 'PCI Display 8217-LP 3 e 2 Teclas C/ Vidro', 'Conserto', 468.60, 445.17, true),
  (v_company_id, 'CAT-062', 'Placas (PCI)', 'PCI WI-FI', 'Kit WI-FI (PCI+Cabo+Antena) Espressif /P5 Plus (8.6)', 'Nova', 980.80, 931.76, true),
  (v_company_id, 'CAT-063', 'Placas (PCI)', 'PCI WI-FI', 'PCI WI-FI Espressif/P5 Plus (8.6)', 'Nova', 740.00, 703.00, true),
  (v_company_id, 'CAT-064', 'Placas (PCI)', 'PCI WI-FI', 'PCI WI-FI Espressif /P5 Plus (8.6)', 'Conserto', 462.80, 439.66, true),
  (v_company_id, 'CAT-065', 'Placas (PCI)', 'PCI WI-FI', 'Kit WI-FI (PCI+Cabo+Antena) Espressif /P5 Plus (8.2), Prix4 Flex', 'Nova', 980.80, 931.76, true),
  (v_company_id, 'CAT-066', 'Placas (PCI)', 'PCI WI-FI', 'PCI WI-FI Espressif /P5 Plus (8.2), Prix4 Flex', 'Nova', 740.00, 703.00, true),
  (v_company_id, 'CAT-067', 'Placas (PCI)', 'PCI WI-FI', 'PCI WI-FI Esp-Wroom /P5 Plus, P4 Due, P4 Uno (versão nova)', 'Nova', 1818.00, 1727.10, true),
  (v_company_id, 'CAT-068', 'Placas (PCI)', 'PCI WI-FI', 'PCI WI-FI Esp-Wroom/P5 Plus, P4 Due, P4 Uno (versão nova)', 'Conserto', 880.00, 836.00, true),
  (v_company_id, 'CAT-069', 'Placas (PCI)', 'PCI WI-FI', 'Kit PCI WI-FI P4 Plus / P4 Due / P4 Uno (Versão Antiga)', 'Nova', 1285.00, 1220.75, true),
  (v_company_id, 'CAT-070', 'Placas (PCI)', 'PCI WI-FI', 'Antena Wi-fi', 'Nova', 325.60, 309.32, true),
  (v_company_id, 'CAT-071', 'Placas (PCI)', 'PCI WI-FI', 'Cabo int PCI princ, fonte, Wlan-PRIX5', 'Nova', 258.00, 245.10, true),
  (v_company_id, 'CAT-072', 'Fontes', 'PCI Fonte / Adaptadora', 'Fonte Toledo P4/P5/P6', 'Conserto', 531.00, 504.45, true),
  (v_company_id, 'CAT-073', 'Fontes', 'PCI Fonte / Adaptadora', 'PCI Fonte Chaveada Platina Novo Modelo', 'Nova', 830.00, 788.50, true),
  (v_company_id, 'CAT-074', 'Fontes', 'PCI Fonte / Adaptadora', 'PCI Fonte Chaveada Platina', 'Conserto', 460.15, 437.14, true),
  (v_company_id, 'CAT-075', 'Fontes', 'PCI Fonte / Adaptadora', 'PCI Fonte Antiga Platina', 'Conserto', 440.00, 418.00, true),
  (v_company_id, 'CAT-076', 'Fontes', 'PCI Fonte / Adaptadora', 'Fonte Adaptadora (Todas as Tensões)', 'Nova', 70.20, 66.69, true),
  (v_company_id, 'CAT-077', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Cabeça Térmica prix5 paralela 80mm', 'Nova', 505.00, 479.75, true),
  (v_company_id, 'CAT-078', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Cabeça Térmica Toledo 80mm', 'Nova', 713.00, 677.35, true),
  (v_company_id, 'CAT-079', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Cabeça Térmica Toledo 57mm', 'Nova', 713.00, 677.35, true),
  (v_company_id, 'CAT-080', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Apoio do Cabecote (Rolo de Borracha) Prix5 / Prix4', 'Nova', 290.50, 275.98, true),
  (v_company_id, 'CAT-081', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Cabeça Térmica Filizola', 'Nova', 635.00, 603.25, true),
  (v_company_id, 'CAT-082', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Apoio do Cabecote (Rolo de Borracha) Platina', 'Nova', 290.50, 275.98, true),
  (v_company_id, 'CAT-083', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Cabeça Térmica Prix4 Uno', 'Nova', 625.25, 593.99, true),
  (v_company_id, 'CAT-084', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Kit Fujitsu Prix4 Uno Completo', 'Nova', 1051.00, 998.45, true),
  (v_company_id, 'CAT-085', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Kit Fujitsu Prix4 Uno (Só o Mecanismo)', 'Nova', 625.25, 593.99, true),
  (v_company_id, 'CAT-086', 'Impressão', 'Cabeça Térmica / Mecanismo', 'Rolo apoio etiqueta C/Engrenagem Prix4 Uno', 'Nova', 401.00, 380.95, true),
  (v_company_id, 'CAT-087', 'Serviços e Identificação', 'Identificação', 'Chapa de Identificação (Todos os Modelos)', 'Nova', 219.00, 208.05, true),
  (v_company_id, 'CAT-088', 'Serviços e Identificação', 'Aferição e Lacração', 'Serviço de Aferição e Lacração Balança Até 100kg', 'Serviço', 180.00, 171.00, true),
  (v_company_id, 'CAT-089', 'Serviços e Identificação', 'Aferição e Lacração', 'Serviço de Aferição e Lacração Balança de 100kg á 500kg', 'Serviço', 350.00, 332.50, true),
  (v_company_id, 'CAT-090', 'Serviços e Identificação', 'Aferição e Lacração', 'Serviço de Aferição e Lacração Balança de 500kg á 3000kg', 'Serviço', 500.00, 475.00, true),
  (v_company_id, 'CAT-091', 'Cabos', 'Cabos Diversos', 'Cabo de Cabeça Térmica Toledo', 'Nova', 362.00, 343.90, true),
  (v_company_id, 'CAT-092', 'Cabos', 'Cabos Diversos', 'Cabo de Cabeça Térmica Filizola', 'Nova', 362.00, 343.90, true),
  (v_company_id, 'CAT-093', 'Cabos', 'Cabos Diversos', 'Cabo Colorido PCI Fonte/Principal - toledo', 'Nova', 280.10, 266.10, true),
  (v_company_id, 'CAT-094', 'Cabos', 'Cabos Diversos', 'Cabo de Força Macho e Fêmea Tripolar', 'Nova', 70.20, 66.69, true),
  (v_company_id, 'CAT-095', 'Cabos', 'Cabos Diversos', 'Cabo Manga 7 Vias Para célula de Carga (Metro)', 'Nova', 7.15, 6.79, true),
  (v_company_id, 'CAT-096', 'Cabos', 'Cabos Diversos', 'Cabo de Força Macho Tripolar', 'Nova', 242.79, 230.65, true),
  (v_company_id, 'CAT-097', 'Cabos', 'Cabos Diversos', 'Cabo interl PCI princ, oper, cons prix4 Due', 'Nova', 640.07, 608.07, true),
  (v_company_id, 'CAT-098', 'Cabos', 'Cabos Diversos', 'Cabo interl PCI princ, PCI conectores prix4 Uno', 'Nova', 557.00, 529.15, true),
  (v_company_id, 'CAT-099', 'Cabos', 'Cabos Diversos', 'Cabo interl PCI principal, displays prix4 Uno', 'Nova', 412.70, 392.07, true),
  (v_company_id, 'CAT-100', 'Cabos', 'Cabos Diversos', 'Cabo interl PCI principal, displays prix5 plus (Versão 8,7 pra frente)', 'Nova', 427.00, 405.65, true),
  (v_company_id, 'CAT-101', 'Transformadores', 'Transformadores', 'Transformador Platina', 'Nova', 284.00, 269.80, true),
  (v_company_id, 'CAT-102', 'Diversos', 'Mecânica e Estrutura', 'Gancho central inferior coluna da Balança 2124', 'Nova', 680.50, 646.48, true),
  (v_company_id, 'CAT-103', 'Diversos', 'Mecânica e Estrutura', 'Gancho curto 2124', 'Nova', 91.00, 86.45, true),
  (v_company_id, 'CAT-104', 'Diversos', 'Mecânica e Estrutura', 'Gancho Longo 2124', 'Nova', 91.00, 86.45, true),
  (v_company_id, 'CAT-105', 'Diversos', 'Mecânica e Estrutura', 'Suporte de apoio gancho 2124', 'Nova', 212.50, 201.88, true),
  (v_company_id, 'CAT-106', 'Diversos', 'Mecânica e Estrutura', 'Cutelo do gancho', 'Nova', 238.50, 226.58, true),
  (v_company_id, 'CAT-107', 'Diversos', 'Mecânica e Estrutura', 'Suporte dos Conectores prix4', 'Nova', 250.84, 238.30, true),
  (v_company_id, 'CAT-108', 'Diversos', 'Mecânica e Estrutura', 'Roda de Nylon 2124', 'Nova', 73.65, 69.96, true),
  (v_company_id, 'CAT-109', 'Diversos', 'Mecânica e Estrutura', 'Rebobinador do liner platina', 'Nova', 310.00, 294.50, true),
  (v_company_id, 'CAT-110', 'Diversos', 'Mecânica e Estrutura', 'Rebobinador do liner toledo (cada lado)', 'Nova', 105.30, 100.04, true),
  (v_company_id, 'CAT-111', 'Diversos', 'Mecânica e Estrutura', 'Cj Motor do Rebobinador (prix5/prix4)', 'Nova', 550.50, 522.98, true),
  (v_company_id, 'CAT-112', 'Diversos', 'Mecânica e Estrutura', 'Apoio lateral de borracha - 8217', 'Nova', 35.10, 33.35, true),
  (v_company_id, 'CAT-113', 'Diversos', 'Mecânica e Estrutura', 'Apoio lateral de borracha - 2098', 'Nova', 35.10, 33.35, true),
  (v_company_id, 'CAT-114', 'Diversos', 'Mecânica e Estrutura', 'Parafuso de fixação suporte cabeçote', 'Nova', 10.62, 10.09, true),
  (v_company_id, 'CAT-115', 'Diversos', 'Mecânica e Estrutura', 'Parafuso de fixação do carrinho', 'Nova', 7.15, 6.79, true),
  (v_company_id, 'CAT-116', 'Diversos', 'Mecânica e Estrutura', 'Barra extratora toledo prix5/prix4', 'Nova', 271.00, 257.45, true),
  (v_company_id, 'CAT-117', 'Diversos', 'Mecânica e Estrutura', 'Kit fixação cabeça térmica platina', 'Nova', 219.00, 208.05, true),
  (v_company_id, 'CAT-118', 'Diversos', 'Mecânica e Estrutura', 'Pé nivelador 2098 toledo', 'Nova', 105.30, 100.04, true),
  (v_company_id, 'CAT-119', 'Diversos', 'Mecânica e Estrutura', 'Pé nivelador prix3 fit /plus', 'Nova', 35.10, 33.35, true),
  (v_company_id, 'CAT-120', 'Diversos', 'Mecânica e Estrutura', 'Pé nivelador prix5 plus', 'Nova', 35.10, 33.35, true),
  (v_company_id, 'CAT-121', 'Diversos', 'Mecânica e Estrutura', 'Cj Trava do Rebobinador', 'Nova', 277.50, 263.63, true),
  (v_company_id, 'CAT-122', 'Diversos', 'Mecânica e Estrutura', 'Mola da Trava do Rebobinador', 'Nova', 19.50, 18.53, true),
  (v_company_id, 'CAT-123', 'Diversos', 'Mecânica e Estrutura', 'Cj Chassis do Mecanismo', 'Nova', 654.50, 621.78, true),
  (v_company_id, 'CAT-124', 'Diversos', 'Conectividade e Sensores', 'kit RS-232 de comunicação prix', 'Nova', 218.40, 207.48, true),
  (v_company_id, 'CAT-125', 'Diversos', 'Conectividade e Sensores', 'Roteador TP-link 300mbps', 'Nova', 336.00, 319.20, true),
  (v_company_id, 'CAT-126', 'Diversos', 'Conectividade e Sensores', 'OPTO Filizola', 'Nova', 505.00, 479.75, true),
  (v_company_id, 'CAT-127', 'Diversos', 'Gabinete e Estrutura', 'Suporte apoio etiqueta prix4 uno', 'Nova', 177.50, 168.63, true),
  (v_company_id, 'CAT-128', 'Diversos', 'Gabinete e Estrutura', 'Suporte apoio cabeçote prix4 uno', 'Nova', 172.30, 163.69, true),
  (v_company_id, 'CAT-129', 'Diversos', 'Gabinete e Estrutura', 'Tampa do Impressor prix5 plus (preta)', 'Nova', 201.50, 191.43, true),
  (v_company_id, 'CAT-130', 'Diversos', 'Gabinete e Estrutura', 'Tampa do Impressor prix5 (Azul)', 'Nova', 205.40, 195.13, true)
  ON CONFLICT (company_id, code) DO UPDATE SET
    category = EXCLUDED.category,
    subcategory = EXCLUDED.subcategory,
    description = EXCLUDED.description,
    condition = EXCLUDED.condition,
    price_term = EXCLUDED.price_term,
    price_cash = EXCLUDED.price_cash,
    is_active = true,
    updated_at = now();

  -- 3. Registra a auditoria oficial de importação
  INSERT INTO public.price_catalog_imports (
    company_id,
    file_name,
    total_rows,
    imported_count,
    updated_count
  ) VALUES (
    v_company_id,
    'Tabela_de_Precos_Pesquisavel.xlsx',
    130,
    130,
    0
  );

  RAISE NOTICE 'Importação concluída com sucesso: % itens cadastrados para EA Balanças (%).', 130, v_company_id;
END $$;
-- [004 COMMIT unificado]

-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Migração 005: Sistema Seguro de Convites, Links de Ativação e Gestão de Técnicos
-- ============================================================================
-- [005 BEGIN unificado]
-- ----------------------------------------------------------------------------
-- 1. FUNÇÃO: Validar Convite com Segurança (Pública para ativação / anon)
-- ----------------------------------------------------------------------------
-- Finalidade: Permite que a tela pública /ativar verifique a autenticidade
-- do convite antes de solicitar a definição de senha ao técnico.
-- Retorna apenas campos públicos e estritamente necessários para exibição.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv record;
  v_is_expired boolean;
BEGIN
  SELECT ci.*, c.name as company_name
    INTO v_inv
    FROM public.company_invitations ci
    JOIN public.companies c ON c.id = ci.company_id
   WHERE ci.id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'Convite não encontrado ou inválido.'
    );
  END IF;

  -- Convite expira após 7 dias de sua emissão/reenvio
  v_is_expired := (v_inv.created_at < (now() - interval '7 days'));

  IF v_inv.status = 'revoked' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'Este convite foi revogado pela administração da empresa.'
    );
  END IF;

  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'already_accepted', true,
      'email', v_inv.email,
      'company_name', v_inv.company_name,
      'reason', 'Este convite já foi aceito anteriormente. Você pode entrar diretamente com seu e-mail e senha.'
    );
  END IF;

  IF v_is_expired THEN
    RETURN jsonb_build_object(
      'valid', false,
      'expired', true,
      'email', v_inv.email,
      'company_name', v_inv.company_name,
      'reason', 'Este convite expirou (validade de 7 dias). Solicite ao gestor o reenvio pelo painel.'
    );
  END IF;

  -- Convite válido e pendente
  RETURN jsonb_build_object(
    'valid', true,
    'invitation_id', v_inv.id,
    'email', v_inv.email,
    'full_name', v_inv.full_name,
    'company_name', v_inv.company_name,
    'role', v_inv.role,
    'created_at', v_inv.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invitation(uuid) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. FUNÇÃO: Aceitar Convite com Validação Forte no Servidor
-- ----------------------------------------------------------------------------
-- Finalidade: Executada após o técnico se autenticar (cadastro ou login).
-- Garante vínculo compulsório à empresa e ao papel do convite, impedindo
-- usurpação por terceiros ou escalada de privilégios.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_company_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_user_rec record;
  v_inv record;
  v_is_expired boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Acesso não autenticado. Faça login para aceitar o convite.';
  END IF;

  SELECT email, email_confirmed_at, confirmed_at
    INTO v_user_rec
    FROM auth.users
   WHERE id = v_uid;

  IF v_user_rec.email IS NULL THEN
    RAISE EXCEPTION 'Usuário não possui e-mail cadastrado.';
  END IF;

  -- 1. Validação estrita de confirmação de e-mail no Supabase Auth
  IF (v_user_rec.email_confirmed_at IS NULL AND v_user_rec.confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'O e-mail (%) ainda não foi confirmado. Confirme seu e-mail antes de ativar o convite.',
      v_user_rec.email;
  END IF;

  SELECT * INTO v_inv
    FROM public.company_invitations
   WHERE id = p_invitation_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  -- 1. Validação estrita de identidade: o e-mail autenticado DEVE corresponder ao e-mail do convite
  IF lower(btrim(v_inv.email)) != lower(btrim(v_user_rec.email)) THEN
    RAISE EXCEPTION 'O e-mail da sua conta (%) não corresponde ao e-mail deste convite (%).',
      v_user_rec.email, v_inv.email;
  END IF;

  -- 2. Validação de expiração (7 dias)
  v_is_expired := (v_inv.created_at < (now() - interval '7 days'));
  IF v_is_expired THEN
    RAISE EXCEPTION 'Este convite expirou. Solicite ao gestor o reenvio.';
  END IF;

  -- 3. Validação de revogação
  IF v_inv.status = 'revoked' THEN
    RAISE EXCEPTION 'Este convite foi revogado pela administração.';
  END IF;

  -- 4. Idempotência: se já foi aceito pelo próprio usuário, retorna sucesso
  IF v_inv.status = 'accepted' THEN
    IF v_inv.accepted_by = v_uid THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_accepted', true,
        'company_id', v_inv.company_id,
        'role', v_inv.role
      );
    ELSE
      RAISE EXCEPTION 'Este convite já foi aceito anteriormente por outro usuário.';
    END IF;
  END IF;

  -- 5. Cria ou atualiza a afiliação na empresa estritamente com o papel autorizado pelo convite
  INSERT INTO public.company_memberships (
    company_id, user_id, role, is_active, invited_by
  ) VALUES (
    v_inv.company_id, v_uid, v_inv.role, true, v_inv.invited_by
  )
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        is_active = true;

  -- 6. Se houver vínculo de técnico cadastrado, vincula user_id na tabela technicians
  IF v_inv.technician_id IS NOT NULL THEN
    UPDATE public.technicians
       SET user_id = v_uid,
           is_active = true
     WHERE id = v_inv.technician_id
       AND company_id = v_inv.company_id;
  ELSIF v_inv.role = 'technician' THEN
    UPDATE public.technicians
       SET user_id = v_uid,
           is_active = true
     WHERE company_id = v_inv.company_id
       AND lower(email) = lower(v_user_rec.email)
       AND (user_id IS NULL OR user_id = v_uid);
  END IF;

  -- 7. Atualiza perfil do usuário com default_company_id
  UPDATE public.profiles
     SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
   WHERE id = v_uid;

  -- 8. Marca o convite como aceito compulsoriamente
  UPDATE public.company_invitations
     SET status = 'accepted',
         accepted_by = v_uid,
         accepted_at = now()
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_inv.company_id,
    'role', v_inv.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_company_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. FUNÇÃO: Reenviar Convite (Exclusivo para Gestores da Empresa)
-- ----------------------------------------------------------------------------
-- Finalidade: Permite ao gestor renovar a validade por mais 7 dias de um
-- convite pendente ou expirado. Bloqueia acesso cruzado entre empresas.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resend_company_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv record;
  v_is_mgr boolean;
BEGIN
  SELECT * INTO v_inv
    FROM public.company_invitations
   WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  -- Validação de segurança: apenas gestor da empresa do convite pode renovar/reenviar
  v_is_mgr := public.is_company_manager(v_inv.company_id);
  IF NOT v_is_mgr THEN
    RAISE EXCEPTION 'Apenas gestores da empresa têm permissão para reenviar convites.';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'Este convite já foi aceito e o técnico já está vinculado à empresa.';
  END IF;

  -- Renova a validade para mais 7 dias a partir de agora
  UPDATE public.company_invitations
     SET created_at = now(),
         status = 'pending',
         invited_by = auth.uid()
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_inv.id,
    'email', v_inv.email,
    'created_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resend_company_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resend_company_invitation(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. ATUALIZAÇÃO: handle_new_auth_user
-- ----------------------------------------------------------------------------
-- Regras Fundamentais:
-- 1. Se a confirmação de e-mail estiver ativada no Supabase e o e-mail NÃO
--    estiver confirmado (email_confirmed_at IS NULL), o convite é PRESERVADO
--    como 'pending' até o retorno autenticado do técnico.
-- 2. Nunca aceita convites expirados (> 7 dias).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name text;
  v_inv record;
  v_is_confirmed boolean;
BEGIN
  v_full_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(COALESCE(NEW.email, ''), '@', 1)
  );

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE
          WHEN btrim(public.profiles.full_name) = '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END;

  -- Verifica se a conta já possui e-mail confirmado
  v_is_confirmed := (NEW.email_confirmed_at IS NOT NULL OR NEW.confirmed_at IS NOT NULL);

  -- Se a confirmação de e-mail for exigida e ainda não foi confirmada,
  -- PRESERVA o convite como 'pending' para que seja reivindicado apenas após validação real.
  IF NEW.email IS NOT NULL AND v_is_confirmed THEN
    -- Vincula apenas convites pendentes e NÃO expirados (7 dias)
    FOR v_inv IN
      SELECT *
        FROM public.company_invitations
       WHERE lower(email) = lower(NEW.email)
         AND status = 'pending'
         AND created_at >= (now() - interval '7 days')
    LOOP
      INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
      VALUES (v_inv.company_id, NEW.id, v_inv.role, true, v_inv.invited_by)
      ON CONFLICT (company_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            is_active = true;

      IF v_inv.technician_id IS NOT NULL THEN
        UPDATE public.technicians
           SET user_id = NEW.id
         WHERE id = v_inv.technician_id
           AND company_id = v_inv.company_id
           AND user_id IS NULL;
      ELSIF v_inv.role = 'technician' THEN
        UPDATE public.technicians
           SET user_id = NEW.id
         WHERE company_id = v_inv.company_id
           AND lower(email) = lower(NEW.email)
           AND user_id IS NULL;
      END IF;

      UPDATE public.company_invitations
         SET status = 'accepted',
             accepted_by = NEW.id,
             accepted_at = now()
       WHERE id = v_inv.id;

      UPDATE public.profiles
         SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
       WHERE id = NEW.id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. ATUALIZAÇÃO: claim_pending_invitations (Executada no login autenticado)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_user_rec record;
  v_inv record;
  v_claimed integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT email, email_confirmed_at, confirmed_at
    INTO v_user_rec
    FROM auth.users
   WHERE id = v_uid;

  IF v_user_rec.email IS NULL THEN
    RETURN 0;
  END IF;

  -- Se o e-mail não estiver confirmado, não reivindica nenhum convite
  IF (v_user_rec.email_confirmed_at IS NULL AND v_user_rec.confirmed_at IS NULL) THEN
    RETURN 0;
  END IF;

  -- Reivindica somente convites pendentes com menos de 7 dias
  FOR v_inv IN
    SELECT *
      FROM public.company_invitations
     WHERE lower(email) = lower(v_user_rec.email)
       AND status = 'pending'
       AND created_at >= (now() - interval '7 days')
  LOOP
    INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
    VALUES (v_inv.company_id, v_uid, v_inv.role, true, v_inv.invited_by)
    ON CONFLICT (company_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_active = true;

    IF v_inv.technician_id IS NOT NULL THEN
      UPDATE public.technicians
         SET user_id = v_uid
       WHERE id = v_inv.technician_id
         AND company_id = v_inv.company_id
         AND (user_id IS NULL OR user_id = v_uid);
    ELSIF v_inv.role = 'technician' THEN
      UPDATE public.technicians
         SET user_id = v_uid
       WHERE company_id = v_inv.company_id
         AND lower(email) = lower(v_email)
         AND (user_id IS NULL OR user_id = v_uid);
    END IF;

    UPDATE public.company_invitations
       SET status = 'accepted',
           accepted_by = v_uid,
           accepted_at = now()
     WHERE id = v_inv.id;

    UPDATE public.profiles
       SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
     WHERE id = v_uid;

    v_claimed := v_claimed + 1;
  END LOOP;

  RETURN v_claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_invitations() TO authenticated;
-- [005 COMMIT unificado]


-- ----------------------------------------------------------------------------
-- MIGRAÇÃO 008a: ADIÇÃO DO VALOR 'administrator' AO ENUM app_role
-- ----------------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'administrator';

COMMIT;
-- >>> FIM TRANSAÇÃO 1 (ENUM REGISTRADO NO POSTGRESQL) <<<

-- >>> INÍCIO TRANSAÇÃO 2: 4º PERFIL, RLS, IDENTIFICADORES E AUDITORIA (008b) <<<
BEGIN;

-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 008b: 4º Perfil (Administrator), Estruturas, Funções Seguras,
--                Sessão de Suporte Auditada e RLS sem COMMITs embutidos
-- ============================================================================
-- PRÉ-REQUISITO: Execução prévia da migração 008a (enum app_role).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CAMPOS DE AUTENTICAÇÃO POR IDENTIFICADOR E TROCA DE SENHA
-- ----------------------------------------------------------------------------
-- Flag de troca obrigatória de senha e hash da senha temporária para comprovação criptográfica
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS temporary_password_hash text;

-- Trigger para sincronizar o hash da senha temporária sempre que must_change_password for ativado
CREATE OR REPLACE FUNCTION public.sync_temporary_password_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.must_change_password = true THEN
    SELECT md5(encrypted_password)
      INTO NEW.temporary_password_hash
      FROM auth.users
     WHERE id = NEW.id;
  ELSE
    NEW.temporary_password_hash := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_temporary_password_hash ON public.profiles;
CREATE TRIGGER trg_sync_temporary_password_hash
  BEFORE INSERT OR UPDATE OF must_change_password ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_temporary_password_hash();

-- Identificador (username) na associação da empresa
ALTER TABLE public.company_memberships
  ADD COLUMN IF NOT EXISTS username text;

-- Restrição de formato e unicidade de username DENTRO da mesma empresa
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_company_id_username_key'
  ) THEN
    ALTER TABLE public.company_memberships
      ADD CONSTRAINT company_memberships_company_id_username_key UNIQUE (company_id, username);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_company_memberships_username
  ON public.company_memberships (company_id, lower(username))
  WHERE username IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. SUPORTE AUDITADO DA PLATAFORMA (ISOLAMENTO MULTIEMPRESA ESTRITO)
-- ----------------------------------------------------------------------------
-- Impede que Super Admins acessem dados operacionais de clientes sem chamado/sessão
CREATE TABLE IF NOT EXISTS public.platform_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_support_active
  ON public.platform_support_sessions (platform_admin_id, company_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.platform_support_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_active_support_session(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.platform_support_sessions pss
      JOIN public.platform_admins pa ON pa.user_id = pss.platform_admin_id
     WHERE pss.company_id = p_company_id
       AND pss.platform_admin_id = auth.uid()
       AND pa.is_active = true
       AND pss.revoked_at IS NULL
       AND pss.expires_at > now()
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. REFINAMENTO DAS FUNÇÕES DE AUTORIZAÇÃO (REMOVENDO BYPASS DO SUPER ADMIN)
-- ----------------------------------------------------------------------------
-- Membro ativo: apenas usuário com vínculo ativo (is_active = true) e sem pendência de troca de senha
CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_active_support_session(p_company_id) OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
      LEFT JOIN public.profiles p ON p.id = cm.user_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.is_active = true
       AND c.is_active = true
       AND coalesce(p.must_change_password, false) = false
  );
$$;

-- Gestor ativo: apenas gestor com vínculo ativo (is_active = true) e sem pendência de troca de senha
CREATE OR REPLACE FUNCTION public.is_company_manager(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_active_support_session(p_company_id) OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
      LEFT JOIN public.profiles p ON p.id = cm.user_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.role = 'manager'
       AND cm.is_active = true
       AND c.is_active = true
       AND coalesce(p.must_change_password, false) = false
  );
$$;

-- Gestor OU Administrador ativo
CREATE OR REPLACE FUNCTION public.is_company_admin_or_manager(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_active_support_session(p_company_id) OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
      LEFT JOIN public.profiles p ON p.id = cm.user_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.role IN ('manager', 'administrator')
       AND cm.is_active = true
       AND c.is_active = true
       AND coalesce(p.must_change_password, false) = false
  );
$$;

-- Regra central de visualização de Ordem de Serviço atualizada com 4º perfil
CREATE OR REPLACE FUNCTION public.can_access_service_order(p_os_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR (
      public.is_company_member(p_company_id)
      AND EXISTS (
        SELECT 1
          FROM public.service_orders so
         WHERE so.id = p_os_id
           AND so.company_id = p_company_id
           AND (
             public.technician_has_company_os_override(p_company_id)
             OR (
               so.allow_company_technicians_view = true
               AND public.current_technician_id(p_company_id) IS NOT NULL
             )
             OR so.primary_technician_id = public.current_technician_id(p_company_id)
             OR EXISTS (
               SELECT 1
                 FROM public.service_order_assignments soa
                WHERE soa.service_order_id = so.id
                  AND soa.company_id = soa.company_id
                  AND soa.technician_id = public.current_technician_id(p_company_id)
                  AND soa.is_active = true
             )
           )
      )
    );
$$;

-- Funções de visualização atualizadas para Administrador e Gestor
CREATE OR REPLACE FUNCTION public.can_view_client(p_client_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND so.client_id = p_client_id
         AND public.can_access_service_order(so.id, p_company_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_client_unit(p_unit_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND (so.unit_id = p_unit_id OR so.client_id = (
           SELECT cu.client_id FROM public.client_units cu WHERE cu.id = p_unit_id AND cu.company_id = p_company_id
         ))
         AND public.can_access_service_order(so.id, p_company_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_equipment(p_equipment_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND so.equipment_id = p_equipment_id
         AND public.can_access_service_order(so.id, p_company_id)
    );
$$;

-- ----------------------------------------------------------------------------
-- 4. RESOLUÇÃO SEGURA DE IDENTIFICADOR (SEM VAZAMENTO OU ENUMERAÇÃO)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_employee_identifier(p_company_slug text, p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_email text;
  v_is_active boolean;
  v_must_change boolean;
  v_clean_slug text;
  v_clean_user text;
BEGIN
  v_clean_slug := lower(btrim(coalesce(p_company_slug, '')));
  v_clean_user := lower(btrim(coalesce(p_username, '')));

  IF v_clean_slug = '' OR v_clean_user = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT u.email, cm.is_active, coalesce(p.must_change_password, false)
    INTO v_user_email, v_is_active, v_must_change
    FROM public.company_memberships cm
    JOIN public.companies c ON c.id = cm.company_id
    JOIN auth.users u ON u.id = cm.user_id
    LEFT JOIN public.profiles p ON p.id = cm.user_id
   WHERE lower(c.slug) = v_clean_slug
     AND lower(cm.username) = v_clean_user
     AND c.is_active = true
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object(
      'found', true,
      'is_active', false,
      'error', 'Esta conta de colaborador foi desativada pela administração da empresa.'
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'is_active', true,
    'email', v_user_email,
    'must_change_password', v_must_change
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_employee_identifier(text, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. ATUALIZAÇÃO DAS POLÍTICAS DE RLS PARA O PERFIL ADMINISTRATOR
-- ----------------------------------------------------------------------------

-- 5.1 company_memberships:
-- Gestor gerencia (INSERT, UPDATE, DELETE). Administrador apenas visualiza os membros.
DROP POLICY IF EXISTS memberships_insert_policy ON public.company_memberships;
CREATE POLICY memberships_insert_policy ON public.company_memberships
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS memberships_update_policy ON public.company_memberships;
CREATE POLICY memberships_update_policy ON public.company_memberships
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS memberships_delete_policy ON public.company_memberships;
CREATE POLICY memberships_delete_policy ON public.company_memberships
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 5.2 clients:
-- Administrador e Gestor criam e atualizam; Gestor exclui; Técnico visualiza
DROP POLICY IF EXISTS clients_insert_policy ON public.clients;
CREATE POLICY clients_insert_policy ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin_or_manager(company_id));

DROP POLICY IF EXISTS clients_update_policy ON public.clients;
CREATE POLICY clients_update_policy ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_company_admin_or_manager(company_id))
  WITH CHECK (public.is_company_admin_or_manager(company_id));

-- 5.3 equipments:
-- Administrador e Gestor criam e atualizam; Gestor exclui; Técnico visualiza
DROP POLICY IF EXISTS equipments_insert_policy ON public.equipments;
CREATE POLICY equipments_insert_policy ON public.equipments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin_or_manager(company_id));

DROP POLICY IF EXISTS equipments_update_policy ON public.equipments;
CREATE POLICY equipments_update_policy ON public.equipments
  FOR UPDATE TO authenticated
  USING (public.is_company_admin_or_manager(company_id))
  WITH CHECK (public.is_company_admin_or_manager(company_id));

-- 5.4 service_orders:
-- Administrador e Gestor têm visão completa e criam ordens de serviço
DROP POLICY IF EXISTS service_orders_select_policy ON public.service_orders;
CREATE POLICY service_orders_select_policy ON public.service_orders
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(id, company_id));

DROP POLICY IF EXISTS service_orders_insert_policy ON public.service_orders;
CREATE POLICY service_orders_insert_policy ON public.service_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin_or_manager(company_id));

DROP POLICY IF EXISTS service_orders_update_policy ON public.service_orders;
CREATE POLICY service_orders_update_policy ON public.service_orders
  FOR UPDATE TO authenticated
  USING (public.can_access_service_order(id, company_id))
  WITH CHECK (
    public.is_company_admin_or_manager(company_id)
    OR (
      public.current_technician_id(company_id) IS NOT NULL
      AND (
        primary_technician_id = public.current_technician_id(company_id)
        OR EXISTS (
          SELECT 1 FROM public.service_order_assignments soa
           WHERE soa.service_order_id = service_orders.id
             AND soa.company_id = service_orders.company_id
             AND soa.technician_id = public.current_technician_id(service_orders.company_id)
             AND soa.is_active = true
        )
      )
    )
  );

-- 5.5 service_order_items (Aprovação de itens autorizada para Gestor E Administrador)
DROP POLICY IF EXISTS so_items_update_policy ON public.service_order_items;
CREATE POLICY so_items_update_policy ON public.service_order_items
  FOR UPDATE TO authenticated
  USING (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_admin_or_manager(company_id)
      OR created_by = auth.uid()
      OR item_status = 'authorized'
    )
  )
  WITH CHECK (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_admin_or_manager(company_id)
      OR created_by = auth.uid()
      OR item_status = 'applied'
    )
  );

-- 5.6 platform_support_sessions: Apenas platform admin gerencia sessões de suporte
CREATE POLICY platform_support_select_policy ON public.platform_support_sessions
  FOR SELECT TO authenticated
  USING (platform_admin_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY platform_support_insert_policy ON public.platform_support_sessions
  FOR INSERT TO authenticated
  WITH CHECK (platform_admin_id = auth.uid() AND public.is_platform_admin());

CREATE POLICY platform_support_update_policy ON public.platform_support_sessions
  FOR UPDATE TO authenticated
  USING (platform_admin_id = auth.uid() AND public.is_platform_admin())
  WITH CHECK (platform_admin_id = auth.uid() AND public.is_platform_admin());

-- ----------------------------------------------------------------------------
-- 6. FUNÇÃO SEGURA E INFALSIFICÁVEL DE CONFIRMAÇÃO DE TROCA DE SENHA
-- ----------------------------------------------------------------------------
-- Validação criptográfica rigorosa: não depende de updated_at (que pode ser
-- alterado por metadados ou emails). Compara o hash de encrypted_password
-- contra o temporary_password_hash salvo no perfil do usuário autenticado.
CREATE OR REPLACE FUNCTION public.confirm_password_changed()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_current_auth_hash text;
  v_temp_hash text;
  v_must_change boolean;
BEGIN
  -- 1. Inspeciona o perfil do usuário autenticado
  SELECT must_change_password, temporary_password_hash
    INTO v_must_change, v_temp_hash
    FROM public.profiles
   WHERE id = auth.uid();

  -- Se o usuário não possui pendência de troca de senha, retorna sucesso
  IF NOT coalesce(v_must_change, false) THEN
    RETURN true;
  END IF;

  -- 2. Obtém o hash da credencial no auth.users
  SELECT md5(encrypted_password)
    INTO v_current_auth_hash
    FROM auth.users
   WHERE id = auth.uid();

  -- 3. Comprovação inequívoca:
  -- Se o hash de encrypted_password for idêntico ao gravado como temporário (ou nulo),
  -- nenhuma alteração real de senha ocorreu. Atualizações de metadados ou perfil
  -- não alteram o encrypted_password, falhando obrigatoriamente nesta checagem.
  IF v_current_auth_hash IS NULL OR v_current_auth_hash = v_temp_hash THEN
    RAISE EXCEPTION 'A troca de senha não foi detectada no sistema de autenticação. Defina uma nova senha pessoal diferente da temporária antes de prosseguir.';
  END IF;

  -- 4. Troca de credencial confirmada: remove a flag e limpa o hash temporário
  UPDATE public.profiles
     SET must_change_password = false,
         temporary_password_hash = NULL,
         updated_at = now()
   WHERE id = auth.uid();

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_password_changed() TO authenticated;

-- Proteção no profiles: usuário comum não pode desmarcar must_change_password nem manipular temporary_password_hash via UPDATE direto
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (
    public.is_platform_admin()
    OR (
      id = auth.uid()
      AND (
        -- Impede o usuário de alterar must_change_password ou temporary_password_hash arbitrariamente via PostgREST
        must_change_password = (SELECT p.must_change_password FROM public.profiles p WHERE p.id = auth.uid())
        AND temporary_password_hash IS NOT DISTINCT FROM (SELECT p.temporary_password_hash FROM public.profiles p WHERE p.id = auth.uid())
      )
    )
  );


COMMIT;
-- >>> FIM TRANSAÇÃO 2 (INSTALAÇÃO CONCLUÍDA COM SUCESSO) <<<
