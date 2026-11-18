import json
import os
import uuid
from urllib import request as http_request
from urllib.error import URLError
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .models import Record, SyncEvent

SERVICE = 'operations'
MODULES = ['warehouse-management', 'inventory-management', 'production']
TARGETS = {'commercial': os.getenv('COMMERCIAL_URL', 'http://localhost:8002'), 'finance-people': os.getenv('FINANCE_PEOPLE_URL', 'http://localhost:8003')}

def dispatch(event_type, module, record):
    routes = {'inventory-management': ['commercial'], 'warehouse-management': ['commercial'], 'production': ['finance-people']}
    for target in routes.get(module, []):
        body = {'event_id': str(uuid.uuid4()), 'event_type': event_type, 'source_service': SERVICE, 'module': module, 'payload': {'record_id': record.external_id, 'data': record.data, 'status': record.status, 'target_module': 'sales' if target == 'commercial' else 'finance-accounting'}}
        try:
            req = http_request.Request(f"{TARGETS[target]}/api/sync/events/", data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
            http_request.urlopen(req, timeout=3).read()
        except URLError:
            pass

@csrf_exempt
@require_http_methods(['GET', 'POST'])
def records(request):
    if request.method == 'GET':
        rows = Record.objects.filter(module=request.GET.get('module')) if request.GET.get('module') else Record.objects.all()
        return JsonResponse({'records': [{'id': row.external_id, 'module': row.module, 'data': row.data, 'status': row.status, 'source_service': row.source_service} for row in rows.order_by('-created_at')]})
    body = json.loads(request.body or '{}')
    module, data = body.get('module'), body.get('data', {})
    if module not in MODULES: return JsonResponse({'error': 'Unsupported module'}, status=400)
    record = Record.objects.create(external_id=body.get('id', f'{SERVICE}-{uuid.uuid4().hex[:10]}'), module=module, data=data, status=body.get('status', 'Open'))
    dispatch(f'{module}.record.created', module, record)
    return JsonResponse({'record': {'id': record.external_id, 'module': record.module, 'data': record.data, 'status': record.status}}, status=201)

@csrf_exempt
@require_http_methods(['PATCH'])
def record_detail(request, external_id):
    try: record = Record.objects.get(external_id=external_id)
    except Record.DoesNotExist: return JsonResponse({'error': 'Record not found'}, status=404)
    body = json.loads(request.body or '{}'); record.status = body.get('status', record.status); record.data.update(body.get('data', {})); record.save(); dispatch(f'{record.module}.record.updated', record.module, record)
    return JsonResponse({'record': {'id': record.external_id, 'module': record.module, 'data': record.data, 'status': record.status}})

@csrf_exempt
@require_http_methods(['POST'])
def sync_event(request):
    body = json.loads(request.body or '{}')
    with transaction.atomic():
        event, created = SyncEvent.objects.get_or_create(event_id=body.get('event_id'), defaults={'event_type': body.get('event_type', 'sync'), 'source_service': body.get('source_service', 'unknown'), 'payload': body.get('payload', {})})
        if created:
            payload = body.get('payload', {})
            Record.objects.get_or_create(external_id=f"sync-{event.event_id}", defaults={'module': payload.get('target_module', body.get('module', 'synced')), 'data': payload, 'status': 'Synced', 'source_service': body.get('source_service', 'unknown')})
    return JsonResponse({'accepted': True, 'duplicate': not created})
