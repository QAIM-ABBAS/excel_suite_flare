# Excel Suite API Worker

Cloudflare Worker backend for the Excel Automation Suite.

## Setup

### 1. Install dependencies

```bash
cd worker
npm install
```

### 2. Create D1 Database

```bash
npx wrangler d1 create excel-suite-db
```

Copy the database ID and update `wrangler.toml`.

### 3. Initialize Database Schema

```bash
npx wrangler d1 execute excel-suite-db --file=schema.sql
```

### 4. Create R2 Bucket

```bash
npx wrangler r2 bucket create excel-suite-files
```

### 5. Local Development

```bash
npm run dev
```

### 6. Deploy to Cloudflare

```bash
npm run deploy
```

## Environment Variables

Update `wrangler.toml` with your actual D1 database ID after creation.

## API Endpoints

### POST /api/tools/:tool
Process files using various tools (merge, convert, duplicates, etc.)

### GET /api/tools/download?file=:filename
Download a processed file.

### GET /api/tools/history
Get file processing history.

### GET /api/tools/errors
Get error logs.

### DELETE /api/tools/history?id=:id
Delete a history record.

### DELETE /api/tools/history
Clear all history records.
