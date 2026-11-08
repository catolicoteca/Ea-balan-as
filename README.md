# EA Balanças — Sistema SaaS de Assistência Técnica (Etapa 1)

Sistema SaaS multiempresa (*multi-tenant*) em português do Brasil para gestão corporativa de assistência técnica e metrologia de balanças em campo, desenvolvido com **React**, **TypeScript**, **Tailwind CSS** e **Supabase** (Auth, PostgreSQL 17 com Row Level Security e Storage).

---

## Status do Banco de Dados Supabase (`gbaomygprofsdhgxrgtm` — EAbalanças)

A migração inicial [`supabase/migrations/001_initial_schema.sql`](./supabase/migrations/001_initial_schema.sql) **já foi aplicada e verificada diretamente no projeto Supabase conectado (`EAbalanças`)**:

- **15 tabelas** criadas no schema `public` com `ENABLE ROW LEVEL SECURITY` ativo em 100% delas.
- **59 políticas RLS** ativas (`53` em `public` + `6` em `storage.objects`).
- **3 buckets do Supabase Storage** criados (`company-assets`, `os-attachments`, `os-signatures`).
- **0 registros fictícios:** o banco permanece limpo, pronto para o primeiro acesso real.

---

## Primeiro Acesso

1. Abra a aplicação e clique em **Criar nova conta** (utilizando um e-mail membro da organização Supabase ou após configurar SMTP/confirmação de e-mail no painel do Supabase).
2. Confirme o e-mail recebido e faça login.
3. Na tela **Inicialização da Plataforma SaaS — EA Balanças**, revise o nome/CNPJ e clique em **Inicializar EA Balanças e Acessar Painel**. Sua conta receberá os perfis de **Administrador da Plataforma** e **Gestor** da EA Balanças (função `bootstrap_initial_platform` bloqueada automaticamente após o primeiro administrador).

---

## Scripts Disponíveis

```bash
npm run dev        # Servidor de desenvolvimento (Vite em 0.0.0.0:5173)
npm run typecheck  # Verificação estática TypeScript (strict)
npm test           # Suíte automatizada PostgreSQL + RLS + Validações
npm run build      # Build de produção
```
