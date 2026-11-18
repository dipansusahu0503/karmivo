from django.urls import path
from core.views import health, modules
from core.api import records, record_detail, sync_event
urlpatterns = [path('health/', health), path('api/modules/', modules), path('api/records/', records), path('api/records/<str:external_id>/', record_detail), path('api/sync/events/', sync_event)]

