from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings
from app.core.supabase import get_supabase, get_supabase_admin

security = HTTPBearer()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    # `iat` lets us reject tokens minted before a password change.
    to_encode.update({"exp": expire, "iat": now})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Validates JWT and returns current user from DB."""
    payload = decode_token(credentials.credentials)
    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    supabase = get_supabase_admin()
    # `.single()` raises PostgrestAPIError on zero rows, which the global
    # error middleware then surfaces as a 500. `.maybe_single()` returns
    # None instead, so we can convert the "JWT references a deleted user"
    # case into a clean 401 here.
    result = supabase.table("users").select("*").eq("id", user_id).maybe_single().execute()

    if not result or not result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # Session invalidation: reject tokens minted before the user's last
    # password change. Skipped unless BOTH values are present — existing
    # tokens (no `iat`) and users who never changed their password
    # (token_valid_after IS NULL) are unaffected. A parse hiccup falls
    # through to "allow" rather than locking everyone out.
    token_valid_after = result.data.get("token_valid_after")
    iat = payload.get("iat")
    if token_valid_after and iat:
        try:
            tva = datetime.fromisoformat(str(token_valid_after).replace("Z", "+00:00"))
            issued = datetime.fromtimestamp(int(iat), tz=timezone.utc)
            if issued < tva:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session expired. Please sign in again.",
                )
        except HTTPException:
            raise
        except Exception:
            pass

    return result.data


async def require_admin(current_user: dict = Depends(get_current_user)):
    """Guard: only admin role allowed."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def require_student(current_user: dict = Depends(get_current_user)):
    """Guard: student or admin allowed."""
    if current_user.get("role") not in ("student", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return current_user