from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET
SERVICE = 'finance-people'
MODULES = ['finance-accounting', 'banking', 'human-resources']
@require_GET
def health(request):
    database = 'ok'
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
    except Exception:
        database = 'unavailable'
    return JsonResponse({'service': SERVICE, 'status': 'ok' if database == 'ok' else 'degraded', 'database': database})
@require_GET
def modules(request):
    return JsonResponse({'service': SERVICE, 'modules': MODULES})
