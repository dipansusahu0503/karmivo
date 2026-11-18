# ServiceDesk microservices

The frontend keeps each card as an independent application. The backend is split into three Django services, each with its own PostgreSQL database:

| Django service | Frontend cards | API port | Database |
| --- | --- | --- | --- |
| Operations | Warehouse, Inventory, Production | 8001 | operations-db |
| Commercial | Purchasing, Sales, CRM | 8002 | commercial-db |
| Finance & People | Finance & Accounting, Banking, HR | 8003 | finance-people-db |

Each service owns its records. Cross-service changes use `POST /api/sync/events/`. Events are idempotent by `event_id`, so retrying a delivery does not duplicate data. The producer keeps its source record and the receiving service stores a synced record in its own database.

Examples:

- Purchasing or Sales record -> Operations receives an inventory/sales sync event.
- Inventory or Warehouse update -> Commercial receives stock availability.
- Sales record -> Finance & People receives an accounting event.
- Production or Finance update -> the connected service receives a cost/accounting event.

The Business One frontend calls the correct API by card. If a Django API is unavailable during local UI work, it falls back to the existing local demo records and shows a small offline notice.

Start everything with:

```bash
docker compose up --build
```

Health checks:

```text
http://localhost:8001/health/
http://localhost:8002/health/
http://localhost:8003/health/
```
