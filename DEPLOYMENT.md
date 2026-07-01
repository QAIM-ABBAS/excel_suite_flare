# Cloudflare Pages + Workers Deployment Guide

This guide explains how to deploy the Excel Automation Suite to Cloudflare Pages (frontend) and Cloudflare Workers (backend).

## Prerequisites

1. Cloudflare account (free tier works)
2. Node.js 18+ installed
3. Wrangler CLI installed (`npm install -g wrangler`)
4. Cloudflare login (`wrangler login`)

## Step 1: Deploy the Backend (Worker)

### 1.1 Navigate to worker directory

```bash
cd worker
```

### 1.2 Install dependencies

```bash
npm install
```

### 1.3 Create D1 Database

```bash
npx wrangler d1 create excel-suite-db
```

Copy the database ID from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "excel-suite-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 1.4 Initialize Database Schema

```bash
npx wrangler d1 execute excel-suite-db --file=schema.sql
```

### 1.5 Create R2 Bucket

```bash
npx wrangler r2 bucket create excel-suite-files
```

### 1.6 Deploy the Worker

```bash
npm run deploy
```

Note the Worker URL from the output (e.g., `https://excel-suite-api.your-subdomain.workers.dev`).

## Step 2: Deploy the Frontend (Pages)

### 2.1 Navigate to project root

```bash
cd ..
```

### 2.2 Update environment variables

Create or update `.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://excel-suite-api.your-subdomain.workers.dev
```

### 2.3 Build and deploy to Cloudflare Pages

```bash
npm run pages:deploy
```

Alternatively, you can use the Cloudflare dashboard:

1. Go to Cloudflare Pages
2. Click "Create a project"
3. Connect your Git repository
4. Set build configuration:
   - Build command: `npm run build`
   - Build output directory: `out`
   - Environment variables: Add `NEXT_PUBLIC_API_URL`

### 2.4 Update CORS in Worker

After deployment, update the Worker's CORS configuration to allow your Pages domain.

Edit `worker/src/index.ts`:

```typescript
app.use('*', cors({
  origin: 'https://your-pages-project.pages.dev',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));
```

Then redeploy the worker:

```bash
cd worker
npm run deploy
```

## Step 3: Verify Deployment

1. Visit your Pages URL (e.g., `https://your-pages-project.pages.dev`)
2. Test a simple tool (e.g., merge two CSV files)
3. Check that history and error logs work

## Troubleshooting

### CORS Errors

If you see CORS errors in the browser console:
1. Ensure the Worker's CORS origin matches your Pages URL
2. Redeploy the Worker after updating CORS

### API Connection Issues

1. Verify `NEXT_PUBLIC_API_URL` is set correctly
2. Check the Worker is deployed and running
3. Test the Worker directly: `curl https://your-worker.workers.dev/`

### Database Errors

1. Ensure D1 database is initialized with the schema
2. Check the database ID in `wrangler.toml`

### File Upload Issues

1. Ensure R2 bucket is created
2. Check Worker has permission to access R2

## Cost Estimate

| Service | Free Tier | Paid (estimated) |
|---------|-----------|------------------|
| Cloudflare Pages | 500 builds/month, unlimited requests | $0 (free) |
| Cloudflare Workers | 100,000 requests/day | $5/month + $0.50/million requests |
| Cloudflare D1 | 5GB storage, 10M reads/day | $0.75/GB storage |
| Cloudflare R2 | 10GB storage, 1M Class A ops | $0.015/GB storage |

**Total for moderate usage:** ~$5-10/month

## Local Development

### Backend (Worker)

```bash
cd worker
npm run dev
# Worker runs at http://localhost:8787
```

### Frontend (Next.js)

```bash
# In project root
npm run dev
# Frontend runs at http://localhost:3000
```

The frontend will automatically connect to the Worker at `http://localhost:8787` when `NEXT_PUBLIC_API_URL` is not set.

## Next Steps

1. Set up custom domain for Pages (optional)
2. Configure Cloudflare Analytics
3. Set up CI/CD for automatic deployments
4. Monitor Worker logs and performance
