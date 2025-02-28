import Gtk from "gi://Gtk";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

import Xdp from "gi://Xdp";
import XdpGtk from "gi://XdpGtk4";

import { portal } from "../util.js";

import * as xml from "../langs/xml/xml.js";
import * as postcss from "../lib/postcss.js";

import { encode, settings, unstack } from "../util.js";

import Internal from "./Internal.js";
import External from "./External.js";
import { getClassNameType, registerClass } from "../overrides.js";

import { assertBuildable, detectCrash, isPreviewable } from "./utils.js";

/*
  Always default to in-process preview
  Switch to out-of-process preview when Vala is run
  Switch back to in-process preview if any of the following happens
   • A demo is loaded
   • The out-of-process preview Window closed
   • Switching language
   * A file is open
*/

export default function Previewer({
  output,
  builder,
  panel_ui,
  window,
  application,
  data_dir,
  term_console,
}) {
  let panel_code;

  let current;

  const dropdown_preview_align = builder.get_object("dropdown_preview_align");
  // TODO: File a bug libadwaita
  // flat does nothing on GtkDropdown or GtkComboBox or GtkComboBoxText
  dropdown_preview_align.get_first_child().add_css_class("flat");

  const internal = Internal({
    onWindowChange(open) {
      if (current !== internal) return;
      if (open) {
        stack.set_visible_child_name("close_window");
      } else {
        stack.set_visible_child_name("open_window");
      }
    },
    output,
    builder,
    window,
    application,
    dropdown_preview_align,
    panel_ui,
  });
  const external = External({
    onWindowChange(open) {
      if (current !== external) return;
      if (open) {
        stack.set_visible_child_name("close_window");
      } else {
        stack.set_visible_child_name("open_window");
        useInternal().catch(logError);
      }
    },
    output,
    builder,
    panel_ui,
  });

  const code_view_css = builder.get_object("code_view_css");

  let handler_id_ui = null;
  let handler_id_css = null;
  let handler_id_button_open;
  let handler_id_button_close;

  const stack = builder.get_object("stack_preview");
  const button_open = builder.get_object("button_open_preview_window");
  const button_close = builder.get_object("button_close_preview_window");

  settings.bind(
    "preview-align",
    dropdown_preview_align,
    "selected",
    Gio.SettingsBindFlags.DEFAULT,
  );
  dropdown_preview_align.connect("notify::selected", setPreviewAlign);
  function setPreviewAlign() {
    const alignment =
      dropdown_preview_align.selected === 1 ? Gtk.Align.CENTER : Gtk.Align.FILL;
    output.halign = alignment;
    output.valign = alignment;
  }
  setPreviewAlign();

  function start() {
    stop();
    if (handler_id_ui === null) {
      handler_id_ui = panel_ui.connect("updated", () => schedule_update());
    }
    if (handler_id_css === null) {
      handler_id_css = code_view_css.connect("changed", () =>
        schedule_update(),
      );
    }
  }

  function stop() {
    if (handler_id_ui) {
      panel_ui.disconnect(handler_id_ui);
      handler_id_ui = null;
    }
    if (handler_id_css) {
      code_view_css.disconnect(handler_id_css);
      handler_id_css = null;
    }
  }

  // Using this custom scope we make sure that previewing UI definitions
  // with signals doesn't fail - in addition, checkout registerSignals
  const BuilderScope = registerClass(
    {
      Implements: [Gtk.BuilderScope],
    },
    class BuilderScope extends GObject.Object {
      noop() {}
      // https://docs.gtk.org/gtk4/vfunc.BuilderScope.create_closure.html
      vfunc_create_closure(_builder, function_name, flags, _object) {
        if (
          panel_code.panel.visible &&
          panel_code.language === "JavaScript" &&
          flags & Gtk.BuilderClosureFlags.SWAPPED
        ) {
          console.warning(
            'Signal flag "swapped" is unsupported in JavaScript.',
          );
        }
        return this[function_name] || this.noop;
      }
    },
  );

  settings.connect("changed", () => {
    if (settings.get_boolean("auto-preview")) schedule_update();
  });
  let symbols = null;
  async function update(force = false) {
    if (!(force || settings.get_boolean("auto-preview"))) return;
    let text = panel_ui.xml.trim();
    let target_id;
    let tree;
    let original_id;
    let template;

    if (!text) {
      text = `<?xml version="1.0" encoding="UTF-8"?><interface><object class="GtkBox"></object></interface>";`;
    }

    try {
      tree = xml.parse(text);
      ({ target_id, text, original_id, template } = targetBuildable(tree));
    } catch (err) {
      // logError(err);
      console.debug(err);
    }

    if (!target_id) return;

    try {
      assertBuildable(tree);
    } catch (err) {
      console.warn(err.message);
      return;
    }

    if (settings.get_boolean("safe-mode")) {
      // console.time("detectCrash");
      if (await detectCrash(text, target_id)) return;
      // console.timeEnd("detectCrash");
    }

    const builder = new Gtk.Builder();
    const scope = new BuilderScope();
    builder.set_scope(scope);

    registerSignals({ tree, scope, symbols, template });

    term_console.clear();

    try {
      builder.add_from_string(text, -1);
    } catch (err) {
      if (err instanceof GLib.MarkupError || err instanceof Gtk.BuilderError) {
        console.warn(err.message);
        return;
      }
      logError(err);
      return;
    }

    const object_preview = builder.get_object(target_id);
    if (!object_preview) return;

    if (!dropdown_preview_align.visible) {
      dropdown_preview_align.selected = template ? 1 : 0;
    }
    dropdown_preview_align.visible = !!template;

    await current.updateXML({
      xml: text,
      builder,
      object_preview,
      target_id,
      original_id,
      template,
    });
    code_view_css.clearDiagnostics();
    await current.updateCSS(code_view_css.buffer.text);
    symbols = null;
  }

  const schedule_update = unstack(update, logError);

  async function useExternal() {
    if (current !== external) {
      await setPreviewer(external);
    }
    stack.set_visible_child_name("close_window");
    await update(true);
  }

  async function useInternal() {
    if (current !== internal) {
      await setPreviewer(internal);
    }
    await update(true);
  }

  async function setPreviewer(previewer) {
    if (handler_id_button_open) {
      button_open.disconnect(handler_id_button_open);
    }
    if (handler_id_button_close) {
      button_close.disconnect(handler_id_button_close);
    }

    try {
      await current?.closeInspector();
    } catch {}

    try {
      await current?.stop();
    } catch {}

    current = previewer;

    handler_id_button_open = button_open.connect("clicked", async () => {
      try {
        await current.open();
        stack.set_visible_child_name("close_window");
      } catch (err) {
        logError(err);
      }
    });

    handler_id_button_close = button_close.connect("clicked", async () => {
      try {
        await current.close();
        stack.set_visible_child_name("open_window");
      } catch (err) {
        logError(err);
      }
    });

    try {
      await current.start();
    } catch (err) {
      logError(err);
    }
  }

  builder.get_object("button_screenshot").connect("clicked", () => {
    screenshot().catch(logError);
  });
  async function screenshot() {
    const path = GLib.build_filenamev([data_dir, "Workbench screenshot.png"]);

    const success = await current.screenshot({ window, path });
    if (!success) return;

    const parent = XdpGtk.parent_new_gtk(window);

    try {
      await portal.open_uri(
        parent,
        `file://${path}`,
        Xdp.OpenUriFlags.NONE, // flags
        null, // cancellable
      );
    } catch (err) {
      if (err.code !== Gio.IOErrorEnum.CANCELLED) {
        logError(err);
      } else {
        throw err;
      }
    }
  }

  setPreviewer(internal);
  start();

  return {
    start,
    stop,
    update,
    open() {
      return current.open();
    },
    close() {
      return current.close();
    },
    openInspector() {
      return current.openInspector();
    },
    useExternal,
    useInternal,
    setPanelCode(v) {
      panel_code = v;
    },
    setSymbols(_symbols) {
      symbols = _symbols;
    },
  };
}

// We are using postcss because it's also a dependency of prettier
// it would be great to keep the ast around and pass that to prettier
// so there is no need to re-parse but that's not supported yet
// https://github.com/prettier/prettier/issues/9114
// We are not using https://github.com/pazams/postcss-scopify
// because it's not compatible with postcss 8
export function scopeStylesheet(style) {
  const ast = postcss.parse(style);

  for (const node of ast.nodes) {
    if (node.selector) {
      node.selector = `#workbench_output ${node.selector}`;
    }
  }

  let str = "";
  postcss.stringify(ast, (s) => {
    str += s;
  });

  return str;
}

function getTemplate(tree) {
  const template = tree.getChild("template");
  if (!template) return;

  const { parent } = template.attrs;
  if (!parent) return;

  if (!isPreviewable(parent)) return null;

  template.attrs.class = getClassNameType(template.attrs.class);
  const original = tree.toString();
  tree.remove(template);

  const target_id = makeWorkbenchTargetId();
  const el = new xml.Element("object", {
    class: parent,
    id: target_id,
  });
  template.children.forEach((child) => {
    el.cnode(child);
  });
  tree.cnode(el);

  return {
    target_id: el.attrs.id,
    text: tree.toString(),
    original_id: undefined,
    template: encode(original),
  };
}

function findPreviewable(tree) {
  for (const child of tree.getChildren("object")) {
    const class_name = child.attrs.class;
    if (!class_name) continue;

    if (isPreviewable(class_name)) return child;
  }
}

function targetBuildable(tree) {
  const template = getTemplate(tree);
  if (template) return template;

  const child = findPreviewable(tree);
  if (!child) {
    return {};
  }

  const original_id = child.attrs.id;
  const target_id = makeWorkbenchTargetId();
  child.attrs.id = target_id;

  return { target_id, text: tree.toString(), original_id, template: null };
}

function makeSignalHandler(
  { name, handler, after, id, type },
  { symbols, template },
) {
  return function (object, ...args) {
    const symbol = symbols?.[handler];
    const registered_handler = typeof symbol === "function";
    if (registered_handler) {
      symbol(object, ...args);
    }

    const object_name = `${type}${id ? `$${id}` : ""}`;
    // const object_name = object.toString(); // [object instance wrapper GIName:Gtk.Button jsobj@0x2937abc5c4c0 native@0x55fbfe53f620]
    const handler_type = (() => {
      if (template) return "Template";
      if (registered_handler) return "Registered";
      return "Unregistered";
    })();
    const handler_when = after ? "after" : "for";

    console.log(
      `${handler_type} handler "${handler}" triggered ${handler_when} signal "${name}" on ${object_name}`,
    );
  };
}

function registerSignals({ tree, scope, symbols, template }) {
  try {
    const signals = findSignals(tree);
    for (const signal of signals) {
      scope[signal.handler] = makeSignalHandler(signal, { symbols, template });
    }
  } catch (err) {
    logError(err);
  }
}

function findSignals(tree, signals = []) {
  for (const object of tree.getChildren("object")) {
    const signal_elements = object.getChildren("signal");
    signals.push(
      ...signal_elements.map((el) => {
        let id = object.attrs.id;
        if (id && isWorkbenchTargetId(id)) id = "";
        return {
          id,
          type: object.attrs.class,
          ...el.attrs,
        };
      }),
    );

    for (const child of object.getChildren("child")) {
      findSignals(child, signals);
    }
  }
  return signals;
}

const target_id_prefix = "workbench_";
function makeWorkbenchTargetId() {
  return target_id_prefix + GLib.uuid_string_random();
}
function isWorkbenchTargetId(id) {
  return id.startsWith(target_id_prefix);
}
