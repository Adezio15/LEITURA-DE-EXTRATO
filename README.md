# LEITURA-DE-EXTRATO

Sistema para leitura de extratos bancários em PDF, com autenticação e persistência de usuários no Neon/PostgreSQL.

## Configuração

1. Para produção, crie um projeto no Neon e copie a string de conexão.
2. Copie `.env.example` para `.env`.
3. Preencha `DATABASE_URL` e defina uma `SESSION_SECRET` longa e aleatória. Sem `DATABASE_URL`, o desenvolvimento usa automaticamente o arquivo local `database.sqlite`.
4. Instale e inicie o projeto:

```bash
npm install
npm start
```

Ao iniciar, o sistema cria automaticamente a tabela `users` no Neon ou no SQLite local. Acesse `http://localhost:3000`; usuários sem sessão serão direcionados para `/login`.

As senhas são armazenadas com hash `scrypt`, nunca em texto puro.
