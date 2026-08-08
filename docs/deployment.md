# Deployment

## Frontend

```powershell
cd F:\CapInsta\capinsta-production-editor
C:\Users\shrav\.bun\bin\bun.exe install
C:\Users\shrav\.bun\bin\bun.exe run build:web
```

Use `.env.example` or `apps/web/.env.example` as the frontend environment template. Use `NEXT_PUBLIC_CAPINSTA_DEBUG=false` for production.

## Backend

```powershell
cd F:\CapInsta\capinsta-production-editor\backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

For local backend tests, install `requirements-dev.txt`.

Set one real transcription provider key before using Generate AI Captions:

- `GROQ_API_KEY`
- `OPENAI_API_KEY`
- `SARVAM_API_KEY`

Do not deploy `.env`, `.env.local`, `venv`, `node_modules`, `.next`, generated exports, uploads, or local MP4s.

## Coolify VPS Disk Cleanup

If deployment stalls or logs show:

```text
tee: /data/coolify/applications/.../docker-compose.yaml: No space left on device
```

the VPS disk is full and Coolify cannot write deployment configuration. SSH into
the VPS, inspect disk usage, then prune build/image/container/network cache:

```bash
df -h
docker system df
docker builder prune -af
docker image prune -af
docker container prune -f
docker network prune -f
sudo journalctl --vacuum-time=7d
df -h
```

Do not run `docker volume prune` during routine cleanup. Docker volumes may hold
Coolify application data, uploads, model cache, or database/storage state. Prune
volumes only after explicitly confirming what each volume contains and taking
backups where needed.

## Razorpay Production Setup

Set these server-side variables on the web deployment:

```bash
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_PRIVATE_SERVER_PLAN_ID=
DEDICATED_WORKER_PROVISIONING_ADAPTER=manual
```

Configure the Razorpay webhook endpoint:

```text
https://capinsta.huygenstudios.com/api/billing/webhooks/razorpay
```

Enable subscription and payment events at minimum:

- `subscription.activated`
- `subscription.authenticated`
- `subscription.cancelled`
- `subscription.halted`
- `subscription.completed`
- `subscription.charged`
- `payment.captured`
- `order.paid`

Paid entitlements are activated only by verified webhooks. Checkout completion in
the browser is treated as pending until the webhook is processed.
