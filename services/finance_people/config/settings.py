import os
from urllib.parse import urlparse
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'finance-people-local-secret')
DEBUG = os.getenv('DJANGO_DEBUG', '0') == '1'
ALLOWED_HOSTS = ['*']
ROOT_URLCONF = 'config.urls'
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'core.middleware.CorsMiddleware', 'django.middleware.common.CommonMiddleware']
INSTALLED_APPS = ['django.contrib.contenttypes', 'django.contrib.auth', 'core']
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3'}}
database_url = os.getenv('DATABASE_URL')
if database_url:
    parsed = urlparse(database_url)
    DATABASES['default'] = {'ENGINE': 'django.db.backends.postgresql', 'NAME': parsed.path.lstrip('/'), 'USER': parsed.username, 'PASSWORD': parsed.password, 'HOST': parsed.hostname, 'PORT': parsed.port or 5432}

