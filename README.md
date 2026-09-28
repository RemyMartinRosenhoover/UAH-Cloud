# Portable Containerized REST Service

This project runs a pounds-to-kilograms REST API and Redis as two containers. Redis stores the count of successful conversions.

## Prerequisites

- Docker Desktop with Docker Compose v2, or Podman with Compose support
- Node.js 24 or newer with npm for `npm test` and `node scripts/demo.mjs`
- A shell with `curl.exe` available on Windows

## Start the application

From the repository root, build the application image and start both services:

```powershell
docker compose up --build -d
docker compose ps
```

The API is published only to `http://127.0.0.1:8080` by default. Redis has no published host port. Set `HOST_PORT` before `docker compose up` to select another host port.

## Test the API

The unit test suite covers the required success, error, statistics, health, and storage-outage cases:

```powershell
npm ci
npm test
```

Run these commands against the Compose deployment. The `-i` flag displays the HTTP status and JSON response.

```powershell
curl.exe -i "http://127.0.0.1:8080/health"
curl.exe -i "http://127.0.0.1:8080/convert?lbs=0"
curl.exe -i "http://127.0.0.1:8080/convert?lbs=150"
curl.exe -i "http://127.0.0.1:8080/convert?lbs=0.1"
curl.exe -i "http://127.0.0.1:8080/convert"
curl.exe -i "http://127.0.0.1:8080/convert?lbs=abc"
curl.exe -i "http://127.0.0.1:8080/convert?lbs=-5"
curl.exe -i "http://127.0.0.1:8080/stats"
```

Expected successful conversion values are `0`, `68.039`, and `0.045` kg, respectively. The missing and non-numeric requests return `400`; the negative request returns `422`. Only the three successful conversion requests increase `conversions`.

## Record a complete demonstration

With Docker Desktop running, execute the automated, clean-room operational demonstration:

```powershell
node scripts/demo.mjs
```

The script uses isolated Compose resources and host port `8081` by default, so it can run while the regular deployment remains on `8080`. Set `DEMO_HOST_PORT` to override that choice. It verifies every required API case, shows logs and non-root execution, proves Redis persistence across container recreation, removes the named volume, and writes `docs/operational-demo.log`. A successful transcript ends with `PASS: complete container operational demonstration.`

## Inspect and operate

```powershell
docker compose ps
docker compose logs app
docker compose logs redis
docker compose stop
docker compose start
docker compose down
docker compose up -d
curl.exe -i "http://127.0.0.1:8080/stats"
docker compose down -v
```

`docker compose stop` stops containers while retaining them, the network, and named volumes. `docker compose down` removes containers and the Compose network but keeps `redis-data`, so a later `up` retains the conversion count. `docker compose down -v` also removes `redis-data`; use it only after the persistence demonstration.

## Design decisions

The app receives `REDIS_HOST=redis` and `REDIS_PORT=6379` at runtime. `redis` is the Compose service name resolved by Docker's internal DNS, so neither a container IP address nor `localhost` is hard-coded.

Redis is attached only to the internal `application` network and has no `ports` setting. The app also joins an otherwise empty `ingress` network solely for its host-bound HTTP port. This limits Redis access to the application container rather than exposing an unauthenticated datastore on the host.

The named `redis-data` volume is mounted at `/data`, independent of the Redis container filesystem. Redis append-only persistence writes its durable data there, allowing the counter to survive `docker compose down` and container recreation.

Compose provides reproducible images, isolated dependencies, predictable networking, and easy cleanup compared with manually installing Node and Redis on a VM. Its tradeoffs are container-runtime overhead and more operational concepts such as images, networks, volumes, and health checks. A direct VM deployment can be simpler for a tiny single-host service but has more host configuration drift and dependency-management risk.

The app uses only Node's built-in HTTP and TCP modules. Its narrow Redis client opens a fresh connection for each `INCR` or `GET` command, avoiding a runtime package download while keeping the container image small.

Both services use `restart: unless-stopped`. Docker restarts a service after an unexpected exit or Docker daemon restart, but not after an intentional `docker compose stop`. Compose waits for Redis to pass its initial health check before starting the app. If Redis later fails, stateful endpoints return `503` while it is unavailable instead of returning a successful response without incrementing the persistent counter; a later request opens a new connection and succeeds after Redis recovers. The liveness endpoint remains available because it verifies the HTTP process, not Redis readiness.
