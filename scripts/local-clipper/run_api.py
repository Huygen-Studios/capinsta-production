from pathlib import Path
import sys

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from server.main import app

uvicorn.run(app, host="127.0.0.1", port=8000)
