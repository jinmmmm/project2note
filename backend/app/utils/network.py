import socket
from urllib.parse import urlparse


def _get_lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return None


def resolve_share_base_url(configured: str) -> str:
    """Use LAN IP when SHARE_BASE_URL points to localhost (for intranet sharing)."""
    configured = configured.rstrip("/")
    parsed = urlparse(configured)
    host = (parsed.hostname or "").lower()
    if host not in ("localhost", "127.0.0.1"):
        return configured

    lan_ip = _get_lan_ip()
    if not lan_ip:
        return configured

    port = parsed.port or 3015
    scheme = parsed.scheme or "http"
    return f"{scheme}://{lan_ip}:{port}"
