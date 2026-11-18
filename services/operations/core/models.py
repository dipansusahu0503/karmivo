from django.db import models

class Record(models.Model):
    module = models.CharField(max_length=80)
    external_id = models.CharField(max_length=120, unique=True)
    data = models.JSONField(default=dict)
    status = models.CharField(max_length=40, default='Open')
    source_service = models.CharField(max_length=80, default='operations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class SyncEvent(models.Model):
    event_id = models.CharField(max_length=120, unique=True)
    event_type = models.CharField(max_length=120)
    source_service = models.CharField(max_length=80)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

