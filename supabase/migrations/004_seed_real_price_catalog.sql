-- ============================================================================
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

COMMIT;
