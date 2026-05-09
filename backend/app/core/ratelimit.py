"""
Rate limiting setup. Uses slowapi (FastAPI port of flask-limiter).
Defaults to per-IP rate limits; for endpoints that need per-user limits,
pass a key func that returns the user id.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

# Single shared limiter instance — must be attached to app.state in main.py
limiter = Limiter(key_func=get_remote_address, default_limits=["300/minute"])
