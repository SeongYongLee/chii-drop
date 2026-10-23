"""이전 실행 명령도 게임·WebSocket 통합 Node 서버로 연결한다."""
import os
from pathlib import Path

os.execvp("node", ["node", str(Path(__file__).resolve().parent.parent / "server" / "index.js")])
