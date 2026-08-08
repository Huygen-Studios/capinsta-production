def canonical_api_path(path: str) -> str:
    if path == "/api/v1":
        return "/api"
    if path.startswith("/api/v1/"):
        return f"/api/{path.removeprefix('/api/v1/')}"
    return path
