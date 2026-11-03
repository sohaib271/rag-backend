# SalonSync AI - Intelligent RAG-Powered Booking and Customer Experience Platform

SalonSync AI is a multi-tenant customer-support and appointment platform built with NestJS. It combines retrieval-augmented generation (RAG), Gemini-powered intent detection, company-specific knowledge, automated booking workflows, persistent conversations, and queued email notifications.

The companion React frontend is available at [rag-frontend](https://github.com/sohaib271/rag-frontend).

## Main features

- Business-admin signup and company ownership
- PDF, DOCX, TXT, and manually entered company knowledge
- RAG answers using Gemini embeddings and PostgreSQL `pgvector`
- Persistent customer conversations and message history
- Service catalogue with company-specific currencies
- Appointment collection, availability checking, confirmation, cancellation, and rescheduling
- BullMQ and Redis email queue with retry support
- Separate confirmation emails for the customer and company owner

## Prerequisites

PostgreSQL with pgvector, Redis, and ClamAV run as Docker containers in this setup.

## Start infrastructure with Docker

Create and start the pgvector/PostgreSQL container:

```powershell
docker run -d --name salonsync-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=change-me `
  -e POSTGRES_DB=rag_db `
  -p 5433:5432 `
  -v salonsync_pgdata:/var/lib/postgresql/data `
  pgvector/pgvector:pg16
```

Enable the vector extension:

```powershell
docker exec salonsync-postgres psql -U postgres -d rag_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Start Redis for caching and BullMQ email jobs:

```powershell
docker run -d --name salonsync-redis -p 6379:6379 redis:8-alpine
```

Start ClamAV for uploaded-document malware scanning:

```powershell
docker run -d --name salonsync-clamav -p 3310:3310 clamav/clamav:stable
```

ClamAV can take a little while to download signatures and become ready. Check container status with:

```powershell
docker ps
docker logs salonsync-clamav
```

After the containers have been created once, restart them with:

```powershell
docker start salonsync-postgres salonsync-redis salonsync-clamav
```

## Environment configuration

Download the prepared `.env` file using the link included in the project owner's CV and place it directly inside the `rag-backend` directory. No manual environment configuration is required.

## Gmail confirmation emails

Use original, accessible Gmail addresses when registering a business admin or creating a customer. The customer receives appointment confirmations, while the Gmail address of the company owner receives new-booking notifications. The provided `.env` file already contains the sender configuration.

## First-time setup in the application

After signing up as a business admin:

1. Create your company and select its currency and one-time customer capacity.
2. Add or upload a company document in PDF, DOCX, or TXT format. You can also enter the knowledge manually. This content becomes the company's RAG knowledge base and is used to answer customer questions about matters such as opening hours, policies, location, contact details, and general business information.
3. Add the company's services separately from the **Services** section. Include each service's name, price, and average duration. Service records are required for appointment booking, service matching, availability calculations, booking summaries, and confirmation emails.
4. Create a customer account with a real email address, then sign in as that customer to test chat and appointment booking.

Company documents and service records serve different purposes. Mentioning a service only inside an uploaded document does not add it to the booking catalogue; it must also be created in the **Services** section before customers can book it.

Development currently uses TypeORM schema synchronization, so application tables and new columns are created when the backend starts. The Docker command above creates `rag_db`; the separate `docker exec` command enables its `vector` extension.

## Run the backend

From the `rag-backend` directory:

```powershell
npm install
npm run start:dev
```

The API starts at `http://localhost:3000` by default.

Before starting it, ensure:

- The `salonsync-postgres`, `salonsync-redis`, and `salonsync-clamav` containers are running.
- `.env` contains valid Gemini and Gmail credentials.

## Run the frontend

Clone the [frontend repository](https://github.com/sohaib271/rag-frontend), then run:

```powershell
git clone https://github.com/sohaib271/rag-frontend.git
cd rag-frontend
npm install
npm run dev
```

The frontend starts at `http://localhost:5173` and proxies `/api` requests to `http://localhost:3000`.

## Build and test

```powershell
npx nest build
npm test
```

Build the frontend separately with:

```powershell
npm run build
```

Run that command from the frontend directory.
