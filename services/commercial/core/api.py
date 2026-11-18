import json, os, uuid
from urllib import request as http_request
from urllib.error import URLError
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .models import Record, SyncEvent
SERVICE='commercial'; MODULES=['purchasing','sales','crm']; TARGETS={'operations':os.getenv('OPERATIONS_URL','http://localhost:8001'),'finance-people':os.getenv('FINANCE_PEOPLE_URL','http://localhost:8003')}
def dispatch(event_type,module,record):
    targets=['operations'] if module in ['purchasing','sales'] else []
    if module=='sales': targets.append('finance-people')
    for target in targets:
        body={'event_id':str(uuid.uuid4()),'event_type':event_type,'source_service':SERVICE,'module':module,'payload':{'record_id':record.external_id,'data':record.data,'status':record.status,'target_module':'inventory-management' if target=='operations' else 'finance-accounting'}}
        try:
            req=http_request.Request(f"{TARGETS[target]}/api/sync/events/",data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST'); http_request.urlopen(req,timeout=3).read()
        except URLError: pass
@csrf_exempt
@require_http_methods(['GET','POST'])
def records(request):
    if request.method=='GET':
        rows=Record.objects.filter(module=request.GET.get('module')) if request.GET.get('module') else Record.objects.all(); return JsonResponse({'records':[{'id':r.external_id,'module':r.module,'data':r.data,'status':r.status,'source_service':r.source_service} for r in rows.order_by('-created_at')]})
    body=json.loads(request.body or '{}'); module=body.get('module'); data=body.get('data',{})
    if module not in MODULES: return JsonResponse({'error':'Unsupported module'},status=400)
    r=Record.objects.create(external_id=body.get('id',f'{SERVICE}-{uuid.uuid4().hex[:10]}'),module=module,data=data,status=body.get('status','Open')); dispatch(f'{module}.record.created',module,r); return JsonResponse({'record':{'id':r.external_id,'module':r.module,'data':r.data,'status':r.status}},status=201)
@csrf_exempt
@require_http_methods(['PATCH'])
def record_detail(request,external_id):
    try:r=Record.objects.get(external_id=external_id)
    except Record.DoesNotExist:return JsonResponse({'error':'Record not found'},status=404)
    body=json.loads(request.body or '{}'); r.status=body.get('status',r.status); r.data.update(body.get('data',{})); r.save(); dispatch(f'{r.module}.record.updated',r.module,r); return JsonResponse({'record':{'id':r.external_id,'module':r.module,'data':r.data,'status':r.status}})
@csrf_exempt
@require_http_methods(['POST'])
def sync_event(request):
    body=json.loads(request.body or '{}')
    with transaction.atomic():
        event,created=SyncEvent.objects.get_or_create(event_id=body.get('event_id'),defaults={'event_type':body.get('event_type','sync'),'source_service':body.get('source_service','unknown'),'payload':body.get('payload',{})})
        if created:
            payload=body.get('payload',{}); Record.objects.get_or_create(external_id=f"sync-{event.event_id}",defaults={'module':payload.get('target_module',body.get('module','synced')),'data':payload,'status':'Synced','source_service':body.get('source_service','unknown')})
    return JsonResponse({'accepted':True,'duplicate':not created})
