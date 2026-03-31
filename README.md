# Omni

Omni is a local-first chat and workspace app with:
- realtime text channels
- voice channels
- page/project workspace UI
- encrypted chat/file storage for original media
- MinIO-backed image thumbnails for chat previews

## Local Development

Run the frontend and backend manually, and run MinIO separately as a Docker sidecar.

Environment templates:
- copy [backend/.env.example](/home/omi/Omi_Home_NAS/Code/Personal/p2p/backend/.env.example) to `backend/.env`
- copy [frontend/.env.local.example](/home/omi/Omi_Home_NAS/Code/Personal/p2p/frontend/.env.local.example) to `frontend/.env.local`

### 1. Start MinIO only

```bash
docker compose -f docker-compose.dev.yml up -d
```

MinIO endpoints:
- S3 API: `http://localhost:9000`
- Console: `http://localhost:9001`

Default dev credentials:
- user: `omni`
- password: `omni-secret-key`

### 2. Start the backend

```bash
cd backend
npm run dev
```

Backend health:

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:9000/minio/health/live
```

### 3. Start the frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`.

### 4. Stop MinIO

```bash
docker compose -f docker-compose.dev.yml down
```

## Full Docker Deployment

Environment template:
- copy [.env.example](/home/omi/Omi_Home_NAS/Code/Personal/p2p/.env.example) to `.env` if you want to override compose defaults cleanly

Run the app server and MinIO together:

```bash
docker compose up --build
```

This starts:
- `omni-server`
- `minio`

The backend talks to MinIO over Docker networking using the env vars already defined in `docker-compose.yml`.

Notes:
- Omni app is exposed on `2650`
- MinIO stays internal in the main compose stack
- persistent data is stored in:
  - `./p2p-data`
  - `./minio-data`

## Media Preview Notes

- original uploaded files remain encrypted in Omni storage
- image thumbnails are generated server-side and stored in MinIO
- thumbnails should appear automatically in chat
- full original image/file download still uses the encrypted file path
