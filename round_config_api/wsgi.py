"""Entry point gunicorn."""
from app import create_app
application = create_app()
