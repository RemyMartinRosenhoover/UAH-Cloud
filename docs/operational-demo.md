# Operational Demonstration

The following workflow was executed from a clean Docker Compose project on 2026-09-28.

## Build and start

```text
docker compose up --build -d
Image lbs-kg-service:1.0.0 Built
Container uah-cloud-redis-1 Healthy
Container uah-cloud-app-1 Started
```

```text
docker compose ps
NAME                SERVICE   STATUS                    PORTS
uah-cloud-app-1     app       Up (healthy)              127.0.0.1:8080->3000/tcp
uah-cloud-redis-1   redis     Up (healthy)              6379/tcp
```

Redis has no host address in the `PORTS` column. The app container runs without root privileges:

```text
docker compose exec -T app id
uid=1000(node) gid=1000(node) groups=1000(node)
```

## Endpoint checks

```text
GET /health
HTTP/1.1 200 OK
{"status":"ok"}

GET /stats before conversions
HTTP/1.1 200 OK
{"conversions":0}

GET /convert?lbs=0
HTTP/1.1 200 OK
{"lbs":0,"kg":0,"formula":"kg = lbs * 0.45359237"}

GET /convert?lbs=150
HTTP/1.1 200 OK
{"lbs":150,"kg":68.039,"formula":"kg = lbs * 0.45359237"}

GET /convert?lbs=0.1
HTTP/1.1 200 OK
{"lbs":0.1,"kg":0.045,"formula":"kg = lbs * 0.45359237"}

GET /convert
HTTP/1.1 400 Bad Request

GET /convert?lbs=abc
HTTP/1.1 400 Bad Request

GET /convert?lbs=-5
HTTP/1.1 422 Unprocessable Entity

GET /stats after all requests
HTTP/1.1 200 OK
{"conversions":3}
```

## Logs and persistence

```text
docker compose logs app
app-1 | HTTP service listening on port 3000
```

After `docker compose down`, the containers and networks were absent while the named volume remained:

```text
docker volume ls --filter name=uah-cloud_redis-data
DRIVER    VOLUME NAME
local     uah-cloud_redis-data
```

After `docker compose up -d`, the recreated service returned the existing count:

```text
GET /stats
HTTP/1.1 200 OK
{"conversions":3}
```

The final cleanup was performed with `docker compose down -v --rmi local`, which removes the containers, Compose networks, Redis named volume, and locally built application image.
