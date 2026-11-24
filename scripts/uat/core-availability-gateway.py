"""Loopback reverse proxy for the Docker UAT. No credentials in gateway logs."""
import http.client
import http.server
import json
import threading
import urllib.parse

HOP = 'X-Lucy-UAT-Hop-Id'
HOP_HEADERS = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
               'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length'}


class Gateway:
    def __init__(self, web, mcp, evidence, timeout):
        upstreams = [urllib.parse.urlsplit(url) for url in (web, mcp)]
        if any(url.scheme != 'http' or url.hostname != '127.0.0.1' for url in upstreams):
            raise ValueError('gateway upstreams must be Docker loopback HTTP ports')
        lock = threading.Lock()

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def forward(self):
                path = urllib.parse.urlsplit(self.path).path
                upstream = upstreams[path == '/mcp']
                request_id = self.headers.get(HOP)
                connection = http.client.HTTPConnection(upstream.hostname, upstream.port, timeout=timeout)
                request_headers = {key: value for key, value in self.headers.items()
                                   if key.lower() not in HOP_HEADERS | {'host', HOP.lower()}}
                status, response_headers, payload, outcome = 503, [], b'<html>503 Service Unavailable</html>', 'upstream-error'
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    body = self.rfile.read(length) if length else None
                    connection.request(self.command, self.path, body=body, headers=request_headers)
                    response = connection.getresponse()
                    payload = response.read()
                    status, response_headers, outcome = response.status, response.getheaders(), 'forwarded'
                except (OSError, http.client.HTTPException):
                    response_headers = [('Content-Type', 'text/html')]
                finally:
                    connection.close()
                with lock, evidence.open('a') as stream:
                    stream.write(json.dumps({'id': request_id, 'path': path, 'method': self.command,
                                             'status': status, 'outcome': outcome}) + '\n')
                try:
                    self.send_response(status)
                    for key, value in response_headers:
                        if key.lower() not in HOP_HEADERS:
                            self.send_header(key, value)
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except OSError:
                    # The client deadline is recorded separately by the runner.
                    pass

            do_GET = do_POST = forward

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
