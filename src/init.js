import "gi://Gtk?version=4.0";
import "gi://GtkSource?version=5";
import "gi://Adw?version=1";
import "gi://Vte?version=3.91";
import "gi://Soup?version=3.0";
import "gi://WebKit?version=6.0";

import Gio from "gi://Gio";
import Xdp from "gi://Xdp";
import Source from "gi://GtkSource";

Gio._promisify(Xdp.Portal.prototype, "open_uri", "open_uri_finish");

Gio._promisify(
  Gio.InputStream.prototype,
  "read_bytes_async",
  "read_bytes_finish",
);
Gio._promisify(Gio.InputStream.prototype, "read_all_async", "read_all_finish");
Gio._promisify(Gio.InputStream.prototype, "close_async", "close_finish");
Gio._promisify(
  Gio.DataInputStream.prototype,
  "read_line_async",
  "read_line_finish",
);

Gio._promisify(Gio.OutputStream.prototype, "close_async", "close_finish");
Gio._promisify(
  Gio.OutputStream.prototype,
  "write_bytes_async",
  "write_bytes_finish",
);

Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");
Gio._promisify(
  Gio.Subprocess.prototype,
  "wait_check_async",
  "wait_check_finish",
);

Gio._promisify(
  Gio.File.prototype,
  "replace_contents_async",
  "replace_contents_finish",
);
Gio._promisify(Gio.File.prototype, "delete_async", "delete_finish");

Gio._promisify(Source.FileSaver.prototype, "save_async", "save_finish");
Gio._promisify(Source.FileLoader.prototype, "load_async", "load_finish");

Gio._promisify(Gio.DBusProxy, "new", "new_finish");
Gio._promisify(Gio.DBusConnection.prototype, "close", "close_finish");
