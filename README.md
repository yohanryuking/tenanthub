# tenanthub

🇪🇸 Versão em espanhol: [README.es.md](README.es.md)

Micro-SaaS multi-tenant em que o isolamento entre organizações é
garantido pelo Row-Level Security do PostgreSQL — e não por um
`WHERE org_id = ...` que o backend poderia esquecer. Stack: **Angular** ·
**NestJS** · **PostgreSQL + Prisma** (sem Supabase — ver
[ADR 0001](docs/decisions/0001-postgres-managed-over-supabase.md)).

🎥 [Vídeo demo](demo/tenanthub-demo.webm) (~43s, gerado com Playwright
contra a aplicação real): duas organizações isoladas, gating por plano e
audit log em ação.

## Status atual: Sprints 0 a 5 concluídos, Sprint 6 preparado

Implementado e testado:

- Modelo de dados multi-tenant (`organizations`, `users`, `memberships`,
  `invitations`, `refresh_tokens`, `tasks`, `audit_log`) com RLS
  deny-by-default em cada tabela tenant-scoped.
- Role de aplicação não-owner (`tenanthub_app`) que o RLS realmente
  restringe — o backend nunca se conecta com uma role que faça bypass do RLS.
- 10 testes **negativos** de RLS contra um Postgres real: tentam ler,
  atualizar, excluir e inserir dados de outro tenant (ou excluir registros
  de auditoria sem ter o privilégio) e verificam que tudo isso falha.
- Onboarding completo: cadastro (cria org + admin em um único passo), login
  com seletor de organização, convite de membros, aceite de convite e sessão
  mantida com refresh tokens rotacionados (access token de 15 min).
- `tasks` como feature real: paginação, filtros por texto/status,
  edição inline, marcar como concluída, excluir — com rota própria
  `/tasks` no Angular. Um id de outra organização sempre retorna 404, nunca
  403, para não revelar que a linha existe.
- Roles e permissões: `RolesGuard`/`@Roles()` reutilizável no backend,
  gestão de membros (`/members`) com troca de role protegida — uma
  organização nunca pode ficar sem nenhum admin, nem mesmo sob
  duas requisições concorrentes.
- Planos e auditoria: `PlanGuard`/`@RequiresPlan('pro')` controla o acesso
  ao export de CSV de tarefas; um admin pode alterar o plano da sua org
  (simulando um webhook de billing); as cinco ações sensíveis (login, troca
  de plano, convite, troca de role, exclusão de tarefa) ficam registradas
  em `/audit-log`, visível apenas para admins.
- 38 testes e2e de backend sobre HTTP real e SQL direto, mais 1 teste
  unitário — 39 no total, a maioria verificando que um ataque falha, e não
  apenas que o caminho feliz funciona. Além de uma suíte Playwright versionada
  (`frontend/e2e/`) contra um browser real.
- CI (backend, frontend e um job e2e full-stack) que sobe o Postgres,
  aplica as migrations e roda a suíte completa a cada push/PR — com um job
  `deploy` condicionado a esses mesmos testes (Sprint 6, ver abaixo).

Preparado, mas **não executado** (este ambiente de desenvolvimento não tem
credenciais de nenhum provedor de hospedagem): `Dockerfile` do backend,
blueprint do Render (`render.yaml`) + configuração da Vercel
(`frontend/vercel.json`) e os jobs de CI que disparariam o deploy real
depois que os secrets forem configurados. Guia completo, passo a passo, em
**[docs/deploy.md](docs/deploy.md)**.

Para o detalhamento completo, sprint por sprint (o que falta e por quê), ver
**[docs/roadmap.md](docs/roadmap.md)**.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Como o isolamento funciona de ponta a ponta, estrutura do repositório, como rodar tudo |
| [docs/roadmap.md](docs/roadmap.md) | O que está pronto e o que falta, sprint por sprint |
| [docs/threat-model.md](docs/threat-model.md) | Quais ataques foram testados, o que cada mecanismo mitiga, risco residual documentado |
| [docs/deploy.md](docs/deploy.md) | Deploy real: Render (backend + Postgres) + Vercel (frontend), passo a passo |
| [docs/decisions/](docs/decisions/) | ADRs: por que Postgres comum em vez de Supabase, por que Prisma, design das roles de RLS, autenticação própria, refresh tokens, plano/audit log |
| [demo/](demo/) | Vídeo demo + o que cada etapa mostra |

## Quickstart

```bash
docker compose up -d postgres

cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

```bash
cd frontend
npm install
npm start
```

Testar o isolamento (via API):

```bash
curl -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@acme.test","password":"password123","orgSlug":"acme"}'
# copiar o accessToken da resposta
curl localhost:3000/tasks -H "Authorization: Bearer <accessToken>"
```

Ou diretamente no navegador: `http://localhost:4200/register` para
criar uma nova organização, ou `http://localhost:4200/login` com
`alice@acme.test` / `password123` / org `acme` (usuários do seed).

## Testes

```bash
cd backend
npm test         # testes unitários
npm run test:e2e # RLS negativos + fluxos de auth/onboarding + tasks, sobre HTTP real

cd ../frontend
npm test         # testes unitários (Karma)
npm run e2e      # Playwright — requer o backend rodando (ver frontend/README.md)
```
