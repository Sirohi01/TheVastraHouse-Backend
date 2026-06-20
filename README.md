# Vastra House Backend

Standalone Express API backend.

## Local Setup

```bash
npm install
npm run dev
```

Health check:

```bash
GET /api/v1/health
```

## Deploy On Render

- Service type: Web Service
- Runtime: Node
- Node.js version: `22`
- Build command: `npm install --include=dev && npm run build`
- Start command: `npm run start`
- Health check path: `/api/v1/health`

Use Render Environment Variables for production secrets. Do not commit `.env.production`.

## Required Environment

Copy `.env.example` into Render variables and replace placeholders. Make sure:

```bash
BACKEND_PUBLIC_URL=https://your-render-service.onrender.com
FRONTEND_PUBLIC_URL=https://your-frontend.vercel.app
NEXT_PUBLIC_API_BASE_URL=https://your-render-service.onrender.com/api/v1
```
