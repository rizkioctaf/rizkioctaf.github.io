import http.server
import socketserver
import os
import json
import webbrowser
import threading
import time

PORT = 5500
DIRECTORY = "."
WATCH_EXTENSIONS = (".html", ".css", ".js")

# Script JavaScript yang akan disuntikkan ke halaman HTML untuk auto-reload
RELOAD_SCRIPT = """
<script>
(function() {
    let lastModified = null;
    setInterval(async () => {
        try {
            const res = await fetch('/__livereload_check');
            const data = await res.json();
            if (lastModified && lastModified !== data.timestamp) {
                window.location.reload();
            }
            lastModified = data.timestamp;
        } catch (err) {
            console.log('Menunggu server...');
        }
    }, 800); // Cek perubahan setiap 800ms
})();
</script>
"""

def get_latest_timestamp():
    """Mencari waktu modifikasi terbaru dari seluruh file yang dipantau."""
    latest = 0
    for root, _, files in os.walk(DIRECTORY):
        for file in files:
            if file.endswith(WATCH_EXTENSIONS):
                filepath = os.path.join(root, file)
                try:
                    mtime = os.path.getmtime(filepath)
                    if mtime > latest:
                        latest = mtime
                except OSError:
                    pass
    return latest

class LiveReloadHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        # Endpoint khusus untuk pengecekan perubahan file oleh browser
        if self.path == "/__livereload_check":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            payload = json.dumps({"timestamp": get_latest_timestamp()})
            self.wfile.write(payload.encode("utf-8"))
            return

        # Jika request mengarah ke folder, arahkan ke index.html
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            index_path = os.path.join(path, "index.html")
            if os.path.exists(index_path):
                path = index_path

        # Jika file adalah HTML, suntikkan RELOAD_SCRIPT sebelum </body>
        if path.endswith(".html") and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

            if "</body>" in content:
                content = content.replace("</body>", f"{RELOAD_SCRIPT}\n</body>")
            else:
                content += RELOAD_SCRIPT

            encoded = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)
            return

        # Untuk file lain (CSS, JS, gambar, dll), layani secara normal
        super().do_GET()

    def end_headers(self):
        # Mencegah browser menyimpan cache file CSS/JS lama saat pengembangan
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # Sembunyikan log polling agar terminal tetap bersih
        if "/__livereload_check" not in args[0]:
            super().log_message(format, *args)

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    url = f"http://127.0.0.1:{PORT}"
    with ThreadedHTTPServer(("127.0.0.1", PORT), LiveReloadHandler) as httpd:
        print(f"Live Server (Pure Python) aktif di {url}")
        print("Tekan Ctrl+C untuk menghentikan server.")
        
        # Buka browser otomatis setelah 0.8 detik
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer dihentikan.")
