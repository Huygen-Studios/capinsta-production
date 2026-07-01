# Production Network Hardening

This file is deployable guidance; it does not claim the CDN, WAF, firewall, or load balancer has been provisioned.

## Target Exposure

- Public: HTTPS 443 only.
- HTTP 80: redirect to HTTPS only.
- SSH: VPN or fixed allowlisted IP addresses only.
- Private only: database, Redis, backend internal admin APIs, worker ports, object storage credentials, queues, Docker socket.

## Reverse Proxy Example

```nginx
server {
  listen 80;
  server_name capinsta.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name capinsta.example.com;

  client_max_body_size 500m;
  client_body_timeout 60s;
  keepalive_timeout 30s;
  proxy_connect_timeout 10s;
  proxy_send_timeout 120s;
  proxy_read_timeout 120s;

  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  location / {
    proxy_pass http://web:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Request-ID $request_id;
  }
}
```

## Load Balancing

- Use least-connections or equivalent.
- Use readiness checks to drain unhealthy API instances.
- Do not use sticky sessions unless a future stateful feature requires it.
- Keep caption/export work behind queues and worker limits, not synchronous request threads.

## Firewall Checklist

- Block public database, Redis, queue, Docker socket, and worker ports.
- Allow backend outbound only to required providers: Supabase, Redis REST, transcription providers, storage, and monitoring.
- Block metadata-service and private-network SSRF destinations for any future remote import feature.

