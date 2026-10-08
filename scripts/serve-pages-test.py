"""Serve built Pages artifacts under a project subpath for browser tests."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/OutFit/'):
            path = path[len('/OutFit'):]
        elif path != '/OutFit':
            return '/dev/null'
        self.directory = str(Path('dist/pages').resolve())
        return super().translate_path(path)
    def log_message(self, *args):
        pass
ThreadingHTTPServer(('127.0.0.1',4173),Handler).serve_forever()
