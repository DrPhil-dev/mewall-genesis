// All TipTap pieces pinned to the same major version — unpinned imports
// mean "latest", and a new TipTap major release can silently hand the
// browser mismatched pieces that fail on editor construction.
import { Editor, Extension } from "https://esm.sh/@tiptap/core@2";
import StarterKit from "https://esm.sh/@tiptap/starter-kit@2";
import Image from "https://esm.sh/@tiptap/extension-image@2";
import TextStyle from "https://esm.sh/@tiptap/extension-text-style@2";
import FontFamily from "https://esm.sh/@tiptap/extension-font-family@2";
import Link from "https://esm.sh/@tiptap/extension-link@2";
import TextAlign from "https://esm.sh/@tiptap/extension-text-align@2";

// Font size isn't one of TipTap's own bundled extensions — this is a small
// standard-pattern mark extension (the same technique @tiptap/extension-
// font-family uses internally), adding a fontSize attribute to the shared
// textStyle mark rather than needing a whole new package.
const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => element.style.fontSize || null,
            renderHTML: attributes => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            }
          }
        }
      }
    ];
  },
  addCommands() {
    return {
      setFontSize: fontSize => ({ chain }) => chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark("textStyle", { fontSize: null }).run()
    };
  }
});

const MIN_PHOTO_WIDTH_PERCENT = 15;
const MAX_PHOTO_WIDTH_PERCENT = 100;

// Tracks exactly which photo was last clicked in the editor, so the
// Small/Medium/Large/Remove buttons can target it directly and reliably —
// see the node view's pointerdown handler below, and setPhotoSize/
// removePhoto further down.
let lastSelectedImagePos = null;

const CustomImage = Image.extend({
  // Native HTML5 drag-and-drop inside a contenteditable region is
  // notoriously inconsistent across browsers (this is what was causing the
  // "picks up, snaps back" behaviour). Instead we track the pointer
  // ourselves, the same technique used for the resize handle below, and
  // move the node through a real transaction once the drag completes.
  draggable: false,

  addAttributes() {
    // A photo node can be parsed from a bare <img> (older saved memories)
    // or from a <figure class="memory-figure"> wrapper (current format,
    // which carries the caption). TipTap resolves each attribute through
    // its own parseHTML against whichever element matched — so every
    // attribute here has to handle both shapes itself.
    const imgOf = element =>
      element.tagName === "IMG" ? element : element.querySelector("img");
    const figureOf = element =>
      element.closest ? element.closest("figure.memory-figure") : null;

    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: element => imgOf(element)?.getAttribute("src") || null
      },
      alt: {
        default: null,
        parseHTML: element => imgOf(element)?.getAttribute("alt") || null
      },
      title: {
        default: null,
        parseHTML: element => imgOf(element)?.getAttribute("title") || null
      },
      width: {
        default: "35%",
        parseHTML: element => {
          const host = figureOf(element) || element;
          return host.getAttribute("data-width") || host.style?.width || "35%";
        }
      },
      caption: {
        default: "",
        parseHTML: element => {
          const figure = figureOf(element);
          if (figure) return figure.querySelector("figcaption")?.textContent || "";
          return element.getAttribute("data-caption") || "";
        }
      }
    };
  },

  // Saved memories render each photo as a <figure> with an optional
  // <figcaption>, so the caption is physically attached to the photo and
  // moves with it — in the memory cards, the Life Book, everywhere.
  parseHTML() {
    return [
      {
        // The figure rule consumes the whole wrapper including the
        // figcaption, so caption text can't leak into the document as
        // stray paragraph text.
        tag: "figure.memory-figure",
        getAttrs: element => (element.querySelector("img") ? null : false)
      },
      {
        // Bare images (older memories, pasted content). Reject imgs that
        // live inside one of our figures — the figure rule owns those.
        tag: "img[src]",
        getAttrs: element =>
          element.closest && element.closest("figure.memory-figure") ? false : null
      }
    ];
  },

  renderHTML({ node }) {
    const { src, alt, width, caption } = node.attrs;
    const children = [["img", { src, alt: alt || "" }]];
    if (caption && caption.trim()) {
      children.push(["figcaption", {}, caption.trim()]);
    }
    return [
      "figure",
      {
        class: "memory-figure",
        "data-width": width,
        style: `width: ${width};`
      },
      ...children
    ];
  },

  // A custom node view: a corner handle resizes the photo by dragging, and
  // grabbing the photo itself (anywhere but the handle) moves it to a new
  // spot in the memory.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;

      const wrapper = document.createElement("div");
      wrapper.className = "memory-image-wrapper";
      wrapper.style.width = node.attrs.width || "35%";
      wrapper.draggable = false;
      // Belt-and-braces: browsers can still natively drag an <img> inside
      // a contenteditable region even with draggable=false in some cases.
      // Explicitly cancel any native dragstart so only our own pointer-
      // based move logic below can ever move this photo.
      wrapper.addEventListener("dragstart", event => event.preventDefault());

      const img = document.createElement("img");
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || "";
      img.draggable = false;
      img.addEventListener("dragstart", event => event.preventDefault());
      wrapper.appendChild(img);

      // Editable caption line under the photo. It saves into the node's
      // caption attribute, so it's attached to the photo and moves with it.
      // If left empty it simply doesn't appear in the saved memory at all —
      // no silly-looking empty caption bar.
      const captionEl = document.createElement("div");
      captionEl.className = "memory-image-caption";
      captionEl.contentEditable = "true";
      captionEl.spellcheck = true;
      captionEl.setAttribute("data-placeholder", "Add a caption...");
      captionEl.textContent = node.attrs.caption || "";
      captionEl.addEventListener("dragstart", event => event.preventDefault());
      captionEl.addEventListener("keydown", event => {
        // Keep Enter from splitting the caption into new lines — captions
        // are a single line. Escape or Enter just finishes editing.
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          captionEl.blur();
        }
        event.stopPropagation();
      });
      captionEl.addEventListener("blur", () => {
        const newCaption = captionEl.textContent.trim();
        if (newCaption === (currentNode.attrs.caption || "")) return;
        if (typeof getPos !== "function") return;
        const pos = getPos();
        editor.chain().setNodeSelection(pos).updateAttributes("image", {
          caption: newCaption
        }).run();
      });
      wrapper.appendChild(captionEl);

      const handle = document.createElement("span");
      handle.className = "memory-image-resize-handle";
      handle.draggable = false;
      handle.setAttribute("aria-hidden", "true");
      wrapper.appendChild(handle);

      // --- Resize (drag the corner handle) ---

      let dragStartX = 0;
      let startWidthPx = 0;
      let containerWidthPx = 0;

      function commitWidth(percent) {
        if (typeof getPos !== "function") return;
        const pos = getPos();
        editor.chain().setNodeSelection(pos).updateAttributes("image", {
          width: `${percent}%`
        }).run();
      }

      function onResizeMove(event) {
        const deltaX = event.clientX - dragStartX;
        let newWidthPx = startWidthPx + deltaX;
        const minPx = (MIN_PHOTO_WIDTH_PERCENT / 100) * containerWidthPx;
        newWidthPx = Math.max(minPx, Math.min(containerWidthPx, newWidthPx));
        const percent = Math.round((newWidthPx / containerWidthPx) * 100);
        wrapper.style.width = `${percent}%`;
      }

      function onResizeUp() {
        document.removeEventListener("pointermove", onResizeMove);
        document.removeEventListener("pointerup", onResizeUp);
        document.removeEventListener("pointercancel", onResizeUp);
        const percent = Math.round(
          (wrapper.getBoundingClientRect().width / containerWidthPx) * 100
        );
        commitWidth(Math.min(MAX_PHOTO_WIDTH_PERCENT, Math.max(MIN_PHOTO_WIDTH_PERCENT, percent)));
      }

      handle.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();

        const parentEl = wrapper.parentElement;
        containerWidthPx = parentEl
          ? parentEl.getBoundingClientRect().width
          : wrapper.getBoundingClientRect().width;
        dragStartX = event.clientX;
        startWidthPx = wrapper.getBoundingClientRect().width;

        document.addEventListener("pointermove", onResizeMove);
        document.addEventListener("pointerup", onResizeUp);
        document.addEventListener("pointercancel", onResizeUp);
      });

      // --- Move (drag the photo itself to a new spot) ---

      const MOVE_THRESHOLD_PX = 6;
      let moveStartX = 0;
      let moveStartY = 0;
      let isMoving = false;

      function onMoveMove(event) {
        if (!isMoving) {
          const dx = event.clientX - moveStartX;
          const dy = event.clientY - moveStartY;
          if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
          isMoving = true;
          wrapper.classList.add("is-moving");
          document.body.style.cursor = "grabbing";
        }
        event.preventDefault();
      }

      function onMoveUp(event) {
        document.removeEventListener("pointermove", onMoveMove);
        document.removeEventListener("pointerup", onMoveUp);
        document.removeEventListener("pointercancel", onMoveCancel);
        wrapper.classList.remove("is-moving");
        document.body.style.cursor = "";

        if (!isMoving || typeof getPos !== "function") {
          isMoving = false;
          return;
        }
        isMoving = false;

        try {
          const view = editor.view;
          const dropResult = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!dropResult) return;

          const from = getPos();
          const to = from + currentNode.nodeSize;

          // Dropped back onto (or just past) itself — nothing to do.
          if (dropResult.pos >= from && dropResult.pos <= to) return;

          const imageNode = view.state.doc.nodeAt(from);
          if (!imageNode) return;

          const tr = view.state.tr;
          tr.delete(from, to);
          const mappedTarget = tr.mapping.map(dropResult.pos);
          tr.insert(mappedTarget, imageNode);
          view.dispatch(tr);
          view.focus();
          ensureEditableEdges();

          // The photo just moved (and ensureEditableEdges above may have
          // shifted it again) — re-find it by its unique src so Small/
          // Medium/Large keep targeting the right one afterward.
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === "image" && node.attrs.src === imageNode.attrs.src) {
              lastSelectedImagePos = pos;
              return false;
            }
          });
        } catch (error) {
          // If anything about the move fails unexpectedly, leave the photo
          // where it was rather than letting the error escape and risk
          // affecting anything else on the page.
          console.error("Could not move photo:", error);
        }
      }

      // If the gesture gets interrupted (e.g. a stray native drag event
      // sneaking through despite the dragstart guards above), just reset
      // cleanly rather than attempting a move from a possibly-stale state —
      // this is what stops the cursor getting stuck on "grabbing".
      function onMoveCancel() {
        document.removeEventListener("pointermove", onMoveMove);
        document.removeEventListener("pointerup", onMoveUp);
        document.removeEventListener("pointercancel", onMoveCancel);
        wrapper.classList.remove("is-moving");
        document.body.style.cursor = "";
        isMoving = false;
      }

      wrapper.addEventListener("pointerdown", event => {
        if (event.target === handle || captionEl.contains(event.target)) return;

        // Record exactly which photo this is, directly, the same reliable
        // technique the resize handle already uses — so the Small/Medium/
        // Large/Remove buttons can target this exact photo later without
        // depending on the editor's selection still being correct by the
        // time a toolbar button (outside the editor) gets clicked.
        if (typeof getPos === "function") {
          lastSelectedImagePos = getPos();
        }

        moveStartX = event.clientX;
        moveStartY = event.clientY;
        isMoving = false;

        document.addEventListener("pointermove", onMoveMove);
        document.addEventListener("pointerup", onMoveUp);
        document.addEventListener("pointercancel", onMoveCancel);
      });

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== "image") return false;
          currentNode = updatedNode;
          img.src = updatedNode.attrs.src;
          img.alt = updatedNode.attrs.alt || "";
          wrapper.style.width = updatedNode.attrs.width || "35%";
          // Don't rewrite the caption while the user is typing in it —
          // only sync it when the update came from elsewhere.
          if (document.activeElement !== captionEl) {
            const caption = updatedNode.attrs.caption || "";
            if (captionEl.textContent !== caption) captionEl.textContent = caption;
          }
          return true;
        },
        stopEvent(event) {
          return event.target === handle || captionEl.contains(event.target);
        },
        ignoreMutation() {
          return true;
        }
      };
    };
  }
});

const currentYear = new Date().getFullYear();
const settingsKey = "mewall_settings_v1";
const memoryKey = "mewall_memories_v1";
const transcribeUrl = "https://mewall-transcribe.phil-003.workers.dev";
const DEFAULT_PHOTO_WIDTH = "35%";

let settings = loadSettings();
let memories = {};
let selectedYear = null;
let mediaRecorder = null;
let audioChunks = [];
let editor = null;

const setupView = document.getElementById("setupView");
const nameInput = document.getElementById("nameInput");
const birthDateInput = document.getElementById("birthDateInput");
const ownerName = document.getElementById("ownerName");
const ownerSubtitle = document.getElementById("ownerSubtitle");
const titleHome = document.getElementById("titleHome");
const startButton = document.getElementById("startButton");

const wall = document.getElementById("wall");
const menuBar = document.getElementById("menuBar");
const yearView = document.getElementById("yearView");
const yearTitle = document.getElementById("yearTitle");
const yearAge = document.getElementById("yearAge");
const yearCustomTitleInput = document.getElementById("yearCustomTitleInput");
const backButton = document.getElementById("backButton");

const showEditorButton = document.getElementById("showEditorButton");
const memoryList = document.getElementById("memoryList");
const pageForeword = document.getElementById("pageForeword");
const forewordEditorMount = document.getElementById("forewordEditorMount");
const forewordStatus = document.getElementById("forewordStatus");
const pageAfterword = document.getElementById("pageAfterword");
const afterwordEditorMount = document.getElementById("afterwordEditorMount");
const afterwordStatus = document.getElementById("afterwordStatus");
const pageNotes = document.getElementById("pageNotes");
const notesEditorMount = document.getElementById("notesEditorMount");
const notesStatus = document.getElementById("notesStatus");
const contentsList = document.getElementById("contentsList");
const emptyYear = document.getElementById("emptyYear");

const recordAudioButton = document.getElementById("recordAudioButton");
const stopRecordingButton = document.getElementById("stopRecordingButton");
const recordingStatus = document.getElementById("recordingStatus");

const insertPhotoButton = document.getElementById("insertPhotoButton");
const photoInput = document.getElementById("photoInput");
const smallPhotoButton = document.getElementById("smallPhotoButton");
const mediumPhotoButton = document.getElementById("mediumPhotoButton");
const largePhotoButton = document.getElementById("largePhotoButton");
const removePhotoButton = document.getElementById("removePhotoButton");

const floatColLeft = document.getElementById("floatColLeft");
const floatColRight = document.getElementById("floatColRight");
const textStyleButton = document.getElementById("textStyleButton");
const textStylePanel = document.getElementById("textStylePanel");

const importInput = document.getElementById("importInput");
const resetButton = document.getElementById("resetButton");

const actionImportBackup = document.getElementById("actionImportBackup");
const actionExportBackup = document.getElementById("actionExportBackup");
const actionForeword = document.getElementById("actionForeword");
const actionContents = document.getElementById("actionContents");
const actionAfterword = document.getElementById("actionAfterword");
const actionCreateBook = document.getElementById("actionCreateBook");
const actionBookCover = document.getElementById("actionBookCover");

const hamburgerMenuButton = document.getElementById("hamburgerMenuButton");

// A factory rather than a single instance — every memory now has its
// own permanently-live editor (no separate edit/read mode), so this
// gets called once per memory card. All of them share the same
// extensions and image/paste/drop handling.
//
// `editor` (declared near the top of this file) always points at
// whichever instance was most recently focused — that's what the
// floating formatting column acts on, and what insertPhoto/setPhotoSize/
// removePhoto default to when called without an explicit target.
function createMemoryEditor(container) {
  const instance = new Editor({
    element: container,
    extensions: [
      // Dropcursor only reacts to native HTML5 drag events. Since photo
      // moving is now handled entirely by our own pointer tracking (see
      // CustomImage's addNodeView above), leaving it on just means it can
      // still light up if a stray native drag ever sneaks through —
      // exactly the conflict that was causing the stuck "grabbing" cursor.
      StarterKit.configure({ dropcursor: false }),
      CustomImage.configure({ allowBase64: true }),
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({
        types: ["heading", "paragraph"]
      }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank"
        }
      })
    ],
    content: "",
    editorProps: {
      // Belt-and-braces #2: contenteditable has its own built-in "drag the
      // current selection" behaviour, which is separate from any individual
      // element's draggable attribute — that's almost certainly what was
      // still triggering a native drag despite CustomImage's own dragstart
      // guards. Blocking dragstart at the whole editor's root catches it
      // regardless of exactly what inside the editor triggered it.
      handleDOMEvents: {
        dragstart(view, event) {
          event.preventDefault();
          return true;
        }
      },

      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        const image = files.find(file => file.type.startsWith("image/"));

        if (image) {
          event.preventDefault();
          insertPhoto(image, instance);
          return true;
        }

        return false;
      },

      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find(item => item.type.startsWith("image/"));

        if (imageItem) {
          const file = imageItem.getAsFile();
          event.preventDefault();
          insertPhoto(file, instance);
          return true;
        }

        return false;
      }
    }
  });

  wireEditorFocusTracking(instance);

  return instance;
}

// Shared by every editor instance on the page (memory cards AND the
// Foreword/Afterword/Notes editors below) — whichever one last fired
// "focus" becomes the shared `editor` the floating toolbar acts on.
//
// Focusing a DIFFERENT instance makes it "the" active editor, and clears
// the tracked photo position — a tracked position is just a number,
// meaningless once you've moved to a different document. But focus fires
// again on THIS SAME instance too, every time a formatting button briefly
// hands focus to itself and calls .focus() to hand it back — clearing the
// position on every one of those was the actual bug (photo size buttons
// losing the selection after a single click). Only clear it on a genuine
// switch to a different instance.
function wireEditorFocusTracking(instance) {
  instance.on("focus", () => {
    if (editor !== instance) {
      lastSelectedImagePos = null;
    }
    editor = instance;
    updateFloatColumns();
    syncFormatToolbar();
  });

  instance.on("selectionUpdate", () => {
    if (editor === instance) syncFormatToolbar();
  });
}

// Foreword, Afterword, and Notes get the same text-formatting toolbar as
// memory cards (bold/italic/strike/link, headings, font, size, alignment)
// but never need photos, so no Image extension and no drop/paste image
// handling — just the plain-prose subset of createMemoryEditor above.
function createProseEditor(container) {
  const instance = new Editor({
    element: container,
    extensions: [
      StarterKit,
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({
        types: ["heading", "paragraph"]
      }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank"
        }
      })
    ],
    content: ""
  });

  wireEditorFocusTracking(instance);

  return instance;
}

// Plain text saved by the old textarea-based Foreword/Afterword/Notes
// (including any already-imported backup, like Bob Lee's real memoir
// content) needs its paragraph breaks preserved when it first loads into
// the new rich editor — a bare newline gets collapsed by HTML otherwise.
// Content already saved by the new editor is HTML already and passes
// through untouched.
function toRichHtml(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^<(p|h[1-3]|ul|ol|blockquote)[ >]/i.test(trimmed)) return trimmed;

  return trimmed
    .split(/\n+/)
    .map(line => `<p>${escapeHtml(line.trim())}</p>`)
    .join("");
}

let forewordEditor, afterwordEditor, notesEditor;
const proseAutosaveTimers = {};

// Same debounce/flash shape as scheduleAutosave for memories (600ms,
// 1800ms flash) — kept separate since these save straight to a settings
// key rather than into the memories array via commitMemoryChanges.
function scheduleProseAutosave(key, instance, statusEl) {
  const commit = () => {
    settings[key] = instance.getHTML();
    saveSettings();

    if (statusEl) {
      statusEl.classList.remove("hidden");
      clearTimeout(statusEl._hideTimer);
      statusEl._hideTimer = setTimeout(() => statusEl.classList.add("hidden"), 1800);
    }
  };

  clearTimeout(proseAutosaveTimers[key]?.timerId);
  proseAutosaveTimers[key] = {
    commit,
    timerId: setTimeout(() => {
      delete proseAutosaveTimers[key];
      commit();
    }, 600)
  };
}

// Mirrors flushPendingAutosaves for memories — called before Foreword/
// Afterword/Notes get hidden or reloaded, so a change typed in the last
// 600ms is committed synchronously instead of lost.
function flushPendingProseAutosaves() {
  Object.keys(proseAutosaveTimers).forEach(key => {
    const pending = proseAutosaveTimers[key];
    delete proseAutosaveTimers[key];
    clearTimeout(pending.timerId);
    pending.commit();
  });
}

function setupEditor() {
  wireFormatToolbarButtons();

  forewordEditor = createProseEditor(forewordEditorMount);
  afterwordEditor = createProseEditor(afterwordEditorMount);
  notesEditor = createProseEditor(notesEditorMount);

  forewordEditor.on("update", () => scheduleProseAutosave("foreword", forewordEditor, forewordStatus));
  afterwordEditor.on("update", () => scheduleProseAutosave("afterword", afterwordEditor, afterwordStatus));
  notesEditor.on("update", () => scheduleProseAutosave("notes", notesEditor, notesStatus));
}

// The Notepad-style formatting bar: paragraph/heading dropdown, bold,
// italic, strikethrough, and a font dropdown limited to fonts that ship
// with every mainstream device — no external font loading.
//
// Wired up ONCE — these buttons act on whichever memory's editor is
// currently active (the shared "editor" variable), not on a specific
// instance, since every memory can be edited at any time now.
let headingSelect, fontSelect, sizeSelect, boldButton, italicButton,
    strikeButton, linkButton, alignLeftButton, alignCenterButton,
    alignRightButton, alignJustifyButton;

function wireFormatToolbarButtons() {
  headingSelect = document.getElementById("headingSelect");
  fontSelect = document.getElementById("fontSelect");
  sizeSelect = document.getElementById("sizeSelect");
  boldButton = document.getElementById("boldButton");
  italicButton = document.getElementById("italicButton");
  strikeButton = document.getElementById("strikeButton");
  linkButton = document.getElementById("linkButton");
  alignLeftButton = document.getElementById("alignLeftButton");
  alignCenterButton = document.getElementById("alignCenterButton");
  alignRightButton = document.getElementById("alignRightButton");
  alignJustifyButton = document.getElementById("alignJustifyButton");

  if (!headingSelect) return;

  headingSelect.addEventListener("change", () => {
    const value = headingSelect.value;
    if (value === "p") {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().setHeading({ level: Number(value) }).run();
    }
  });

  fontSelect.addEventListener("change", () => {
    const value = fontSelect.value;
    if (value === "") {
      editor.chain().focus().unsetFontFamily().run();
    } else {
      editor.chain().focus().setFontFamily(value).run();
    }
  });

  sizeSelect.addEventListener("change", () => {
    const value = sizeSelect.value;
    if (value === "") {
      editor.chain().focus().unsetFontSize().run();
    } else {
      editor.chain().focus().setFontSize(value).run();
    }
  });

  boldButton.addEventListener("click", () => editor.chain().focus().toggleBold().run());
  italicButton.addEventListener("click", () => editor.chain().focus().toggleItalic().run());
  strikeButton.addEventListener("click", () => editor.chain().focus().toggleStrike().run());

  alignLeftButton.addEventListener("click", () => editor.chain().focus().setTextAlign("left").run());
  alignCenterButton.addEventListener("click", () => editor.chain().focus().setTextAlign("center").run());
  alignRightButton.addEventListener("click", () => editor.chain().focus().setTextAlign("right").run());
  alignJustifyButton.addEventListener("click", () => editor.chain().focus().setTextAlign("justify").run());

  linkButton.addEventListener("click", () => {
    // Already a link — a second click removes it, same toggle pattern as
    // the other formatting buttons.
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    if (editor.state.selection.empty) {
      alert("Select some text first, then click Link to turn it into one.");
      return;
    }

    const url = prompt("Link to which web address?", "https://");
    if (!url || !url.trim() || url.trim() === "https://") return;

    editor.chain().focus().setLink({ href: url.trim() }).run();
  });
}

// Keeps the dropdowns and button states matching wherever the cursor
// currently is, in whichever memory is active. Called from each
// instance's own focus/selectionUpdate listeners (see
// createMemoryEditor), rather than bound to one instance the way it
// used to be.
function syncFormatToolbar() {
  if (!editor || !headingSelect) return;

  if (editor.isActive("heading", { level: 1 })) headingSelect.value = "1";
  else if (editor.isActive("heading", { level: 2 })) headingSelect.value = "2";
  else if (editor.isActive("heading", { level: 3 })) headingSelect.value = "3";
  else headingSelect.value = "p";

  const currentFont = editor.getAttributes("textStyle").fontFamily || "";
  fontSelect.value = currentFont;

  const currentSize = editor.getAttributes("textStyle").fontSize || "";
  sizeSelect.value = currentSize;
  boldButton.classList.toggle("is-active", editor.isActive("bold"));
  italicButton.classList.toggle("is-active", editor.isActive("italic"));
  strikeButton.classList.toggle("is-active", editor.isActive("strike"));
  linkButton.classList.toggle("is-active", editor.isActive("link"));

  alignLeftButton.classList.toggle("is-active", editor.isActive({ textAlign: "left" }));
  alignCenterButton.classList.toggle("is-active", editor.isActive({ textAlign: "center" }));
  alignRightButton.classList.toggle("is-active", editor.isActive({ textAlign: "right" }));
  alignJustifyButton.classList.toggle("is-active", editor.isActive({ textAlign: "justify" }));

  // Deliberately NOT clearing lastSelectedImagePos here based on the
  // editor's own selection state. It's set directly by the photo's own
  // pointerdown handler, which is the reliable part — ProseMirror's own
  // click-to-select doesn't always land cleanly as a NodeSelection on
  // the image (this was the actual bug: clearing on that ever *not*
  // being true wiped out a perfectly good tracked position). It's reset
  // on focus moving to a different memory instead (see createMemoryEditor).
}

async function initialise() {
  // If the rich text editor ever fails to construct (e.g. a library
  // loading problem), the rest of the app — registration, the wall,
  // backups — should still come up rather than dying silently on a
  // blank screen.
  try {
    setupEditor();
  } catch (error) {
    console.error("The memory editor could not be initialised:", error);
  }

  memories = await loadMemories();

  if (!settings.birthYear) {
    setupView.classList.remove("hidden");
    return;
  }

  showWall();
}

// The homepage artwork (corner foliage/flowers and the quill writer)
// belongs to the Home Wall view only — it steps aside inside a year,
// on info pages, and during setup.
function setHomeArtVisible(visible) {
  document.querySelectorAll(".home-art").forEach(el => {
    el.classList.toggle("hidden", !visible);
  });
}

// The subtitle, tagline, nav bar, Menu button, and action row only belong
// on the Home Wall itself — every other page keeps just the title, name,
// and a way back, so there's real content space on smaller screens rather
// than the full banner repeated on every page.
function setWallExtrasVisible(visible) {
  document.querySelectorAll(".wall-only-header").forEach(el => {
    el.classList.toggle("hidden", !visible);
  });
  document.querySelector(".action-row").classList.toggle("hidden", !visible);
  document.getElementById("infoBackButton").classList.toggle("hidden", visible);

  if (visible) {
    requestAnimationFrame(positionMenuButton);
  }
}

// The Menu button floats to the left, aligned with the wall's own left
// edge and vertically centred against the nav row — freeing up the row
// it used to occupy on its own.
function positionMenuButton() {
  const btn = hamburgerMenuButton;
  const wallStage = document.querySelector(".wall-stage");
  const appEl = document.querySelector(".app");
  if (!btn || !wallStage || !appEl || btn.classList.contains("hidden")) return;

  const appRect = appEl.getBoundingClientRect();
  const wallRect = wallStage.getBoundingClientRect();
  const navRect = menuBar.getBoundingClientRect();

  if (wallRect.width === 0 || navRect.height === 0) return;

  const left = wallRect.left - appRect.left;
  const navCenterY = navRect.top + navRect.height / 2 - appRect.top;
  const btnHeight = btn.getBoundingClientRect().height || 40;
  const top = navCenterY - btnHeight / 2;

  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
}

let menuButtonResizeTimeout = null;
window.addEventListener("resize", () => {
  clearTimeout(menuButtonResizeTimeout);
  menuButtonResizeTimeout = setTimeout(positionMenuButton, 150);
});

function showWall() {
  setupView.classList.add("hidden");
  yearView.classList.add("hidden");
  hideInfoPages();
  setWallExtrasVisible(true);
  wall.classList.remove("hidden");
  updateOwnerHeader();
  createWall();
  setHomeArtVisible(true);
  updateScrollJumpVisibility();
}

// The name lives in one place — settings — and everything (the header,
// the Life Book title page) reads it from there. So adding or changing
// it here retroactively applies to every memory ever recorded; nothing
// is stamped per-story.
function updateOwnerHeader() {
  if (settings.name) {
    ownerName.textContent = settings.name;
    ownerName.classList.remove("owner-name-placeholder");
    if (!wall.classList.contains("hidden")) ownerSubtitle.classList.remove("hidden");
  } else {
    ownerName.textContent = "+ Add your name";
    ownerName.classList.add("owner-name-placeholder");
    ownerSubtitle.classList.add("hidden");
  }
  ownerName.title = "Click to change the name on this Life Wall";
}

function changeName() {
  const entered = prompt(
    "What name should appear on this Life Wall?",
    settings.name || ""
  );
  if (entered === null) return; // cancelled

  settings.name = entered.trim();
  saveSettings();
  updateOwnerHeader();
}

function changeBirthDate() {
  const entered = prompt(
    "Date of birth (YYYY-MM-DD)?",
    settings.birthDate || ""
  );
  if (entered === null) return; // cancelled

  const parsed = new Date(entered);
  if (!entered.trim() || isNaN(parsed.getTime())) {
    alert("Please enter a valid date in YYYY-MM-DD format.");
    return;
  }

  settings.birthDate = entered.trim();
  settings.birthYear = parsed.getFullYear();
  saveSettings();
}

function hideInfoPages() {
  // Whichever of Foreword/Afterword/Notes is currently showing is about to
  // be hidden (or reloaded from settings, if navigating back to itself) —
  // commit anything mid-debounce first so nothing typed in the last 600ms
  // is silently lost.
  flushPendingProseAutosaves();

  document.querySelectorAll(".info-page").forEach(page => page.classList.add("hidden"));
}

function showInfoPage(pageId) {
  setupView.classList.add("hidden");
  yearView.classList.add("hidden");
  wall.classList.add("hidden");
  hideInfoPages();
  setWallExtrasVisible(false);
  setHomeArtVisible(false);
  const page = document.getElementById(pageId);
  if (page) page.classList.remove("hidden");

  // The Foreword page is editable — load whatever's been saved so far.
  if (pageId === "pageForeword") {
    forewordEditor.commands.setContent(toRichHtml(settings.foreword));
    forewordStatus.classList.add("hidden");
  }

  if (pageId === "pageAfterword") {
    afterwordEditor.commands.setContent(toRichHtml(settings.afterword));
    afterwordStatus.classList.add("hidden");
  }

  if (pageId === "pageNotes") {
    notesEditor.commands.setContent(toRichHtml(settings.notes));
    notesStatus.classList.add("hidden");
  }

  if (pageId === "pageContents") {
    renderContentsPage();
  }

  if (pageId === "pageBookCover") {
    document.getElementById("bookCoverTitleInput").value = settings.bookCoverTitle || "";
    document.getElementById("bookCoverSubtitleInput").value = settings.bookCoverSubtitle || "";
    document.getElementById("bookCoverStatus").classList.add("hidden");
  }

  updateFloatColumns();
}

// The Contents page is generated live from whatever's actually been
// written — not stored text of its own — so it's always up to date the
// moment you open it.
function renderContentsPage() {
  contentsList.innerHTML = "";

  const years = Object.keys(memories)
    .filter(year => memories[year] && memories[year].length > 0)
    .sort((a, b) => Number(a) - Number(b));

  if (years.length === 0) {
    const empty = document.createElement("p");
    empty.className = "contents-empty";
    empty.textContent = "Nothing recorded yet — once a year has a memory in it, it'll show up here.";
    contentsList.appendChild(empty);
    return;
  }

  years.forEach(year => {
    const age = Number(year) - settings.birthYear;
    const count = memories[year].length;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "contents-item";

    const label = document.createElement("span");
    label.textContent = `${year} — Age ${age}`;
    item.appendChild(label);

    const meta = document.createElement("span");
    meta.className = "contents-age";
    meta.textContent = count === 1 ? "1 memory" : `${count} memories`;
    item.appendChild(meta);

    item.addEventListener("click", () => openYear(Number(year), age));
    contentsList.appendChild(item);
  });
}

function startMeWall() {
  const name = nameInput.value.trim();
  const birthDate = birthDateInput.value;

  if (!name) {
    alert("Please enter your name.");
    return;
  }

  if (!birthDate) {
    alert("Please enter your date of birth.");
    return;
  }

  const birthYear = new Date(birthDate).getFullYear();

  if (!birthYear || birthYear < 1850 || birthYear > currentYear) {
    alert("Please enter a valid date of birth.");
    return;
  }

  settings.name = name;
  settings.birthDate = birthDate;
  settings.birthYear = birthYear;

  saveSettings();
  showWall();
}

const BRICK_GAP = 10;
const MIN_BRICK_WIDTH = 64;
const MAX_BRICK_WIDTH = 130;

// Picks a target bricks-per-row for the available width. This is a starting
// point, not a hard rule — getWallLayout() below shrinks or grows the actual
// brick width to fill that row exactly, so nothing ever overflows.
function pickBricksPerRow(availableWidth) {
  if (availableWidth < 320) return 3;
  if (availableWidth < 480) return 4;
  if (availableWidth < 700) return 6;
  if (availableWidth < 940) return 8;
  return 10;
}

// Works out how many bricks fit the wall's current width, and how wide each
// one needs to be to fill that row exactly — so mobile gets fewer, properly
// sized bricks instead of the desktop brick size squeezed in regardless.
function getWallLayout() {
  const styles = getComputedStyle(wall);
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;

  // clientWidth already excludes the border, so subtracting padding gives
  // the exact content width the brick rows render into.
  const availableWidth = wall.clientWidth - paddingLeft - paddingRight;

  let bricksPerRow = pickBricksPerRow(availableWidth);

  // Size bricks to exactly fill the row: n bricks with (n-1) gaps take
  // n*brickWidth + (n-1)*gap of space, so brickWidth = (available - gaps)/n.
  let brickWidth = Math.floor((availableWidth - (bricksPerRow - 1) * BRICK_GAP) / bricksPerRow);

  // If that pushes bricks below a readable minimum, drop the count instead
  // of shrinking further. If there's more room than the design calls for,
  // cap the width rather than blowing bricks up to fill a huge screen.
  while (brickWidth < MIN_BRICK_WIDTH && bricksPerRow > 3) {
    bricksPerRow -= 1;
    brickWidth = Math.floor((availableWidth - (bricksPerRow - 1) * BRICK_GAP) / bricksPerRow);
  }
  brickWidth = Math.min(brickWidth, MAX_BRICK_WIDTH);

  wall.style.setProperty("--brick-width", `${brickWidth}px`);

  // The staggered row always has one fewer brick, shifted in by exactly
  // half a brick-and-gap on each side, so both row types come out the
  // same total width and stay perfectly centred and interlocked.
  const staggerBricksPerRow = bricksPerRow - 1;
  const unit = brickWidth + BRICK_GAP;
  const staggerOffset = unit / 2;

  return { bricksPerRow, staggerBricksPerRow, staggerOffset };
}

function createWall() {
  wall.innerHTML = "";

  const birthYear = settings.birthYear;
  const futureHorizon = birthYear + 99;
  const { bricksPerRow, staggerBricksPerRow, staggerOffset } = getWallLayout();

  let year = birthYear;
  let rowIndex = 0;

  while (year <= futureHorizon) {
    const isOffsetRow = rowIndex % 2 === 1;
    const rowSize = isOffsetRow ? staggerBricksPerRow : bricksPerRow;

    const row = document.createElement("div");
    row.className = isOffsetRow ? "brick-row offset-row" : "brick-row";

    if (isOffsetRow) {
      row.style.paddingLeft = `${staggerOffset}px`;
      row.style.paddingRight = `${staggerOffset}px`;
    }

    for (let i = 0; i < rowSize && year <= futureHorizon; i++) {
      const age = year - birthYear;
      row.appendChild(createBrick(year, age));
      year++;
    }

    wall.appendChild(row);
    rowIndex++;
  }

  requestAnimationFrame(alignActionRowToBricks);
}

// The client's spec was exact: the action row should span "left of the
// 1959 brick to right of the 1968 brick" — the actual first and last
// bricks in the wall's first row, not an approximate side padding. Bricks
// resize responsively, so this is measured live rather than guessed at
// with a fixed CSS value.
function alignActionRowToBricks() {
  const actionRow = document.querySelector(".action-row");
  const wallStage = document.querySelector(".wall-stage");
  const firstRow = wall.querySelector(".brick-row");
  if (!actionRow || !wallStage || !firstRow) return;

  const rowBricks = firstRow.querySelectorAll(".brick");
  if (rowBricks.length === 0) return;

  const firstBrick = rowBricks[0];
  const lastBrick = rowBricks[rowBricks.length - 1];

  const wallStageRect = wallStage.getBoundingClientRect();
  const firstBrickRect = firstBrick.getBoundingClientRect();
  const lastBrickRect = lastBrick.getBoundingClientRect();

  if (wallStageRect.width === 0) return;

  const leftPad = Math.max(0, firstBrickRect.left - wallStageRect.left);
  const rightPad = Math.max(0, wallStageRect.right - lastBrickRect.right);

  actionRow.style.paddingLeft = `${leftPad}px`;
  actionRow.style.paddingRight = `${rightPad}px`;
}

// Rebuild the wall if the window is resized while it's visible, so the
// brick count always matches the space actually available.
let wallResizeTimeout = null;
window.addEventListener("resize", () => {
  if (wall.classList.contains("hidden")) return;
  clearTimeout(wallResizeTimeout);
  wallResizeTimeout = setTimeout(createWall, 150);
});

function getYearTitle(year) {
  const custom = settings.yearTitles && settings.yearTitles[year];
  return custom && custom.trim() ? custom.trim() : "";
}

function createBrick(year, age) {
  const brick = document.createElement("button");
  brick.className = "brick";
  brick.setAttribute("aria-label", `${year}, age ${age}`);

  if (year === currentYear) brick.classList.add("current");
  if (year > currentYear) brick.classList.add("future");
  if (memories[year] && memories[year].length > 0) {
    brick.classList.add("has-memories");
  }

  const customTitle = getYearTitle(year);
  const tooltipText = customTitle || "Give this year a title (optional)";

  brick.innerHTML = `
    <span class="year">${year}</span>
    <span class="age">Age ${age}</span>
    <span class="brick-title-tooltip" role="tooltip">${escapeHtml(tooltipText)}</span>
    ${settings.lastUsedYear === year ? '<span class="brick-last-used-dot" aria-hidden="true"></span>' : ""}
  `;

  brick.addEventListener("click", () => openYear(year, age));
  brick.addEventListener("mouseenter", () => positionBrickTooltip(brick));
  brick.addEventListener("focus", () => positionBrickTooltip(brick));

  return brick;
}

// The tooltip normally pops upward above the brick — but the wall itself
// clips anything that overflows its own rounded edges, so a brick near
// the top of the wall has nowhere for an upward tooltip to actually
// render. Measured live (not guessed with a fixed row cutoff) because a
// short title needs less headroom than a long one, and the same brick
// might need different treatment depending on what's actually typed into
// it.
function positionBrickTooltip(brick) {
  const tooltip = brick.querySelector(".brick-title-tooltip");
  if (!wall || !tooltip) return;

  const wallRect = wall.getBoundingClientRect();
  const brickRect = brick.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  const spaceAbove = brickRect.top - wallRect.top;
  const neededSpace = tooltipRect.height + 16; // the tooltip's own gap, plus a little breathing room

  brick.classList.toggle("tooltip-below", spaceAbove < neededSpace);
}

// Every card currently on screen keeps its own live editor instance
// here, keyed by the memory object itself (not by array index, since
// deleting one shifts everything after it). Used to destroy instances
// cleanly whenever the list is re-rendered or a memory is removed.
let activeCardEditors = new Map();

// A brand-new memory being written is NOT added to memories[selectedYear]
// (and so isn't saved) until it actually has content — an empty draft
// abandoned by leaving the year just disappears, the same as never
// having clicked "Record another memory" at all.
let draftMemory = null;

function destroyCardEditors() {
  activeCardEditors.forEach(instance => instance.destroy());
  activeCardEditors.clear();
}

function openYear(year, age) {
  selectedYear = year;
  draftMemory = null;

  wall.classList.add("hidden");
  yearView.classList.remove("hidden");
  hideInfoPages();
  setWallExtrasVisible(false);
  document.getElementById("infoBackButton").classList.add("hidden");
  setHomeArtVisible(false);

  yearTitle.textContent = `${year}`;
  yearAge.textContent = `– Age ${age}`;
  yearCustomTitleInput.value = getYearTitle(year);

  renderMemories();
  updateFloatColumns();

  // Marks this brick with the small red dot next time the wall renders,
  // so returning to it always shows at a glance where you left off.
  settings.lastUsedYear = year;
  saveSettings();
}

// Adds a new, immediately-editable memory card at the top of the list —
// this is the only entry point for starting a new memory now, replacing
// the old "Record another memory" reveal-an-editor-box step.
function addNewMemoryCard() {
  // Already got an empty draft sitting there unwritten — just take the
  // person back to it rather than stacking up a second blank one.
  if (draftMemory && !draftMemory.text && !draftMemory.html?.includes("<img")) {
    const existing = activeCardEditors.get(draftMemory);
    if (existing) existing.commands.focus();
    return;
  }

  draftMemory = {
    title: "",
    html: "",
    text: "",
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  renderMemories();

  const instance = activeCardEditors.get(draftMemory);
  if (instance) instance.commands.focus();
}

async function deleteMemory(index) {
  const confirmed = confirm("Remove this memory from this year?");
  if (!confirmed) return;

  memories[selectedYear].splice(index, 1);

  if (memories[selectedYear].length === 0) {
    delete memories[selectedYear];
  }

  if (!(await saveMemories())) {
    alert("Something went wrong saving that change. Please try again.");
  }

  renderMemories();
  createWall();
}

// Debounced autosave — waits for a short pause in typing rather than
// saving on every keystroke, both to avoid hammering storage and so a
// mid-word save can't ever be caught half-written. Tracked per memory
// (not one shared timer) so typing briefly in one card, then another,
// can't cause the first one's pending change to be silently dropped.
const autosaveTimers = new Map();

function scheduleAutosave(memory, cardElement) {
  const existing = autosaveTimers.get(memory);
  if (existing) clearTimeout(existing.timerId);

  const timerId = setTimeout(() => {
    autosaveTimers.delete(memory);
    commitMemoryChanges(memory, cardElement);
  }, 600);

  autosaveTimers.set(memory, { timerId, cardElement });
}

// Something else (deleting a different memory, opening a new year,
// starting a fresh entry) is about to re-render the list and destroy
// every editor instance. Any memory still mid-debounce needs its change
// committed right now, synchronously, before that happens — otherwise
// whatever was typed in the last 600ms just vanishes along with the
// editor it was typed into.
function flushPendingAutosaves() {
  if (autosaveTimers.size === 0) return;

  const pending = Array.from(autosaveTimers.entries());
  autosaveTimers.clear();

  pending.forEach(([memory, { timerId, cardElement }]) => {
    clearTimeout(timerId);
    // Not awaited deliberately — commitMemoryChanges reads the editor's
    // current content synchronously before its first await, so the
    // content is safely captured even though the editor itself gets
    // destroyed a moment later by whatever triggered this flush.
    commitMemoryChanges(memory, cardElement);
  });
}

async function commitMemoryChanges(memory, cardElement) {
  const instance = activeCardEditors.get(memory);
  if (!instance) return;

  const html = instance.getHTML();
  const text = instance.getText().trim();
  const hasImage = html.includes("<img");
  const titleInput = cardElement.querySelector(".memory-title-input");
  const title = titleInput ? titleInput.value.trim() : (memory.title || "");

  memory.title = title;
  memory.html = html;
  memory.text = text;

  const isDraft = memory === draftMemory;

  if (isDraft) {
    // Nothing written yet — stays as an uncommitted draft, nothing to save.
    if (!text && !hasImage) return;

    if (!memories[selectedYear]) memories[selectedYear] = [];
    memories[selectedYear].unshift(memory);
    draftMemory = null;
  } else {
    memory.updatedAt = new Date().toISOString();
  }

  const saved = await saveMemories();
  const savedFlag = cardElement.querySelector(".memory-saved-flag");

  if (!saved) {
    alert(
      "This memory couldn't be saved — this device may be out of storage space. " +
      "Try removing or shrinking the photo, freeing up space on the device."
    );
    return;
  }

  createWall();

  if (savedFlag) {
    savedFlag.classList.remove("hidden");
    clearTimeout(savedFlag._hideTimer);
    savedFlag._hideTimer = setTimeout(() => savedFlag.classList.add("hidden"), 1800);
  }
}

function renderMemories() {
  flushPendingAutosaves();
  destroyCardEditors();
  memoryList.innerHTML = "";
  emptyYear.classList.add("hidden");

  const yearMemories = memories[selectedYear] || [];

  // A year with nothing recorded yet — and no draft already pending —
  // starts straight on a ready-to-type card, rather than an empty page
  // with a button to click first.
  if (yearMemories.length === 0 && !draftMemory) {
    draftMemory = {
      title: "",
      html: "",
      text: "",
      createdAt: new Date().toISOString(),
      updatedAt: null
    };
  }

  const cardsToRender = draftMemory ? [draftMemory, ...yearMemories] : yearMemories;

  cardsToRender.forEach(memory => {
    const card = buildMemoryCard(memory);
    memoryList.appendChild(card);
  });

  // A sensible default so the floating toolbar has something to act on
  // even before the person has clicked into any particular memory.
  const firstInstance = activeCardEditors.values().next().value;
  if (firstInstance) {
    editor = firstInstance;
    syncFormatToolbar();
  }
}

function buildMemoryCard(memory) {
  const isCommitted = memory !== draftMemory;
  const index = isCommitted ? memories[selectedYear].indexOf(memory) : -1;

  const card = document.createElement("article");
  card.className = "memory-card";

  const dateText = memory.updatedAt
    ? `${formatDate(memory.createdAt)} · Updated ${formatShortDate(memory.updatedAt)}`
    : formatDate(memory.createdAt);

  card.innerHTML = `
    ${isCommitted ? `<button type="button" class="memory-delete-button" data-action="delete" data-index="${index}" title="Delete this memory">&#128465;</button>` : ""}
    <input type="text" class="memory-title-input" placeholder="Add a title to this memory" value="${escapeHtml(memory.title || "")}">
    <div class="rich-memory-input memory-editor-mount"></div>
    <small>${dateText} <span class="memory-saved-flag hidden">· Saved</span></small>
  `;

  const titleInput = card.querySelector(".memory-title-input");
  titleInput.addEventListener("input", () => scheduleAutosave(memory, card));

  const mount = card.querySelector(".memory-editor-mount");
  const instance = createMemoryEditor(mount);
  instance.commands.setContent(memory.html || (memory.text ? `<p>${escapeHtml(memory.text)}</p>` : ""));
  instance.on("update", () => scheduleAutosave(memory, card));

  activeCardEditors.set(memory, instance);

  return card;
}

function addPhoto() {
  photoInput.click();
}

const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

// Phone camera photos are often 3–5MB+ at full resolution, and every byte
// of that gets stored as base64 text in localStorage (which has a hard
// 5–10MB-ish ceiling set by the browser). Shrinking to a sensible display
// size and re-encoding as JPEG massively cuts that down before it's saved.
function compressImageFile(file, maxDimension = MAX_PHOTO_DIMENSION) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error || new Error("Could not read that photo."));

    reader.onload = () => {
      const img = new window.Image();

      img.onerror = () => reject(new Error("Could not read that photo."));

      img.onload = () => {
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height / width) * maxDimension);
            width = maxDimension;
          } else {
            width = Math.round((width / height) * maxDimension);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        // Fill white first so transparent PNGs don't turn black when
        // flattened into JPEG (which has no transparency channel).
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY));
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

// Photos are block-level with no text of their own — if one sits at the
// very start or end of a memory, there's nowhere to click to get a text
// cursor without dragging the photo out of the way first. This guarantees
// an empty, clickable paragraph always exists before/after a leading or
// trailing photo, so a click always lands you a working cursor.
function ensureEditableEdges(targetEditor = editor) {
  const doc = targetEditor.state.doc;
  if (doc.childCount === 0) return;

  const paragraph = targetEditor.schema.nodes.paragraph;
  if (!paragraph) return;

  const tr = targetEditor.state.tr;
  let changed = false;

  // Insert at the end first, using the size of the *original* document —
  // safe to do before touching the start, since adding something at the
  // end never shifts position 0.
  if (doc.lastChild && doc.lastChild.type.name === "image") {
    tr.insert(doc.content.size, paragraph.create());
    changed = true;
  }

  if (doc.firstChild && doc.firstChild.type.name === "image") {
    tr.insert(0, paragraph.create());
    changed = true;
  }

  if (changed) {
    targetEditor.view.dispatch(tr);
  }
}

function insertPhoto(file, targetEditor = editor) {
  if (!file || !file.type.startsWith("image/")) return;
  if (!targetEditor) return;

  compressImageFile(file)
    .then(dataUrl => {
      targetEditor.chain().focus().setImage({
        src: dataUrl,
        alt: "Memory photograph",
        width: DEFAULT_PHOTO_WIDTH
      }).run();
      ensureEditableEdges(targetEditor);

      // Make the just-inserted photo immediately usable with Small/
      // Medium/Large without requiring a re-click. Found by its (unique)
      // data URL rather than assuming a position, since the edge-guarantee
      // above may have shifted everything by inserting a paragraph before it.
      targetEditor.state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.src === dataUrl) {
          lastSelectedImagePos = pos;
          return false;
        }
      });
    })
    .catch(error => {
      console.error("Could not add photo:", error);
      alert("That photo couldn't be added. Please try a different one.");
    });
}

function setPhotoSize(width, targetEditor = editor) {
  const node = lastSelectedImagePos !== null ? targetEditor.state.doc.nodeAt(lastSelectedImagePos) : null;

  if (!node || node.type.name !== "image") {
    alert("Click a photo first, then choose a size.");
    return;
  }

  targetEditor.chain().focus().setNodeSelection(lastSelectedImagePos).updateAttributes("image", {
    width
  }).run();
}

function removePhoto(targetEditor = editor) {
  const node = lastSelectedImagePos !== null ? targetEditor.state.doc.nodeAt(lastSelectedImagePos) : null;

  if (!node || node.type.name !== "image") {
    alert("Click a photo first, then choose Remove photo.");
    return;
  }

  const pos = lastSelectedImagePos;
  targetEditor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  lastSelectedImagePos = null;
}

// ------------------------------------------------------------------
// Voice-to-text, generalised so any text box can use it, not just the
// story editor. Each caller passes a "target" describing where the
// transcript should land and how to insert it — the recording and
// transcription plumbing underneath is shared.
//
// A tiptap target inserts as a new paragraph via the editor's own
// commands. A plain-textarea target (Notes, Foreword, Afterword) splices
// the transcript in at the cursor position and fires a normal "input"
// event afterwards, so each page's existing autosave listener picks it
// up exactly as if it had been typed.
// ------------------------------------------------------------------
let activeVoiceTarget = null;

function insertTranscript(transcript) {
  const text = transcript.trim();
  if (!text) return;

  editor.chain().focus().insertContent(`<p>${escapeHtml(text)}</p>`).run();
}

async function startVoiceCapture(target) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    activeVoiceTarget = target;

    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());

      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      await transcribeAudio(audioBlob, target);

      setVoiceButtonState(target, false);
      if (target.statusEl) target.statusEl.classList.add("hidden");
    };

    mediaRecorder.start();

    setVoiceButtonState(target, true);
    if (target.statusEl) {
      target.statusEl.textContent = "Recording...";
      target.statusEl.classList.remove("hidden");
    }
  } catch (error) {
    alert("Microphone access was not available.");
    console.error(error);
  }
}

function stopVoiceCapture() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    if (activeVoiceTarget && activeVoiceTarget.statusEl) {
      activeVoiceTarget.statusEl.textContent = "Transcribing...";
    }
    mediaRecorder.stop();
  }
}

function setVoiceButtonState(target, isRecording) {
  if (target.recordButton) target.recordButton.classList.toggle("hidden", isRecording);
  if (target.stopButton) target.stopButton.classList.toggle("hidden", !isRecording);
}

async function transcribeAudio(audioBlob, target) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "memory.webm");

  try {
    const response = await fetch(transcribeUrl, {
      method: "POST",
      body: formData
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(result);
      alert("I couldn't preserve that just now. Please try again.");
      return;
    }

    insertTranscript(result.text || "");
  } catch (error) {
    console.error(error);
    alert("The transcription service could not be reached.");
  }
}

// Story editor's own record/stop buttons — unchanged behaviour, now
// routed through the shared capture functions above.
function startRecording() {
  return startVoiceCapture({
    recordButton: recordAudioButton,
    stopButton: stopRecordingButton,
    statusEl: recordingStatus
  });
}

function stopRecording() {
  stopVoiceCapture();
}

function exportLife() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    product: "MyLifeWall",
    version: "1.0",
    settings,
    memories
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "MyLifeWall Backup.json";
  link.click();

  URL.revokeObjectURL(link.href);
}

function importLife(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);

      if (!data.settings || !data.settings.birthYear || !data.memories) {
        alert("This does not look like a valid MyLifeWall backup.");
        return;
      }

      settings = data.settings;
      memories = data.memories;

      saveSettings();

      if (!(await saveMemories())) {
        alert("That backup was read, but it's too large to store on this device (storage is full). Try importing on a device with more free space.");
        return;
      }

      alert("Your MyLifeWall has been restored.");
      showWall();
    } catch {
      alert("The import file could not be read.");
    }
  };

  reader.readAsText(file);
}

function createLifeBook() {
  const birthYear = settings.birthYear;
  const years = Object.keys(memories).sort((a, b) => Number(a) - Number(b));
  const owner = settings.name || "My Life";

  let bookHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(owner)} - MyLifeWall Life Book</title>
      <style>
        body {
          font-family: Georgia, "Times New Roman", serif;
          color: #372f28;
          background: #fffdf8;
          margin: 48px;
          line-height: 1.6;
        }

        /* A real blank line between paragraphs, so the text never piles up
           when exported or read — and so other programs importing the PDF
           recognise the paragraph breaks. */
        p {
          margin: 0 0 1em 0;
          text-align: justify;
        }

        .title-page {
          text-align: center;
          margin-top: 120px;
          margin-bottom: 120px;
          page-break-after: always;
        }

        .title-page p {
          text-align: center;
        }

        h1 {
          font-size: 48px;
          font-weight: 500;
        }

        h2 {
          font-size: 26px;
          margin-top: 48px;
          border-bottom: 1px solid #d8cbb8;
          padding-bottom: 10px;
          break-after: avoid-page;
          page-break-after: avoid;
        }

        /* On screen, memories keep a light card look for readability.
           In print (below) the borders and backgrounds are stripped —
           they were the boxed-in artefact on every printed page. */
        .memory {
          margin: 28px 0;
          padding: 24px;
          border: 1px solid #d8cbb8;
          border-radius: 18px;
          background: #fffaf0;
          page-break-inside: avoid;
          break-inside: avoid-page;
        }

        .memory img {
          max-width: 100%;
          max-height: 200mm;
          height: auto;
          display: block;
          margin: 22px auto;
          border-radius: 14px;
        }

        figure.memory-figure {
          display: inline-block;
          vertical-align: top;
          margin: 12px;
          max-width: 100%;
        }

        figure.memory-figure img {
          width: 100%;
          margin: 0;
        }

        figure.memory-figure figcaption {
          text-align: center;
          font-size: 14px;
          font-style: italic;
          color: #6d6254;
          margin-top: 8px;
        }

        small {
          color: #6d6254;
        }

        .print-instructions {
          text-align: center;
          margin-bottom: 24px;
        }

        .print-instructions p {
          color: #6d6254;
          font-size: 14px;
          text-align: center;
        }

        @page {
          size: A4;
          margin: 25mm 22mm;
          @bottom-center {
            content: counter(page);
          }
        }

        @media print {
          body {
            margin: 0;
            background: #ffffff;
          }

          button {
            display: none;
          }

          .print-instructions {
            display: none;
          }

          .year-chapter {
            page-break-before: always;
          }

          .foreword-chapter {
            page-break-before: always;
          }

          .toc-list {
            list-style: none;
            margin: 24px 0 0;
            padding: 0;
            column-count: 2;
            column-gap: 28px;
          }

          .toc-list li {
            padding: 10px 0;
            border-bottom: 1px solid #d8cbb8;
            font-size: 16px;
            break-inside: avoid;
          }

          /* The reported printing artefact: every memory printed inside a
             bordered, tinted box. In print, memories are plain flowing
             text — like a book, not a form. */
          .memory {
            border: none;
            background: transparent;
            border-radius: 0;
            padding: 0;
            margin: 0 0 32px 0;
          }

          .memory img {
            border-radius: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="print-instructions">
        <button onclick="window.print()">Print or Save as PDF</button>
        <p>For page numbers, tick "Headers and footers" in the print dialog's "More settings".</p>
      </div>

      <section class="title-page">
        <h1>${escapeHtml(owner)}</h1>
        <p>${escapeHtml(settings.bookCoverTitle && settings.bookCoverTitle.trim() ? settings.bookCoverTitle.trim() : "My Life Wall")}</p>
        <p>${escapeHtml(settings.bookCoverSubtitle && settings.bookCoverSubtitle.trim() ? settings.bookCoverSubtitle.trim() : "Every life has a story. This is mine.")}</p>
      </section>
  `;

  // A live table of contents — every year that actually has something
  // recorded, in order, same as the Contents brick on the wall shows.
  const writtenYears = years.filter(year => (memories[year] || []).length > 0);
  if (writtenYears.length > 0) {
    const contentsItems = writtenYears
      .map(year => {
        const age = Number(year) - birthYear;
        return `<li>${year} — Age ${age}</li>`;
      })
      .join("\n");

    bookHtml += `
      <section class="foreword-chapter">
        <h2>Contents</h2>
        <ul class="toc-list">${contentsItems}</ul>
      </section>
  `;
  }

  // The foreword, if one has been written, opens the book — its own page
  // straight after the title, like a real book.
  if (settings.foreword && settings.foreword.trim()) {
    bookHtml += `
      <section class="foreword-chapter">
        <h2>Foreword</h2>
        ${cleanMemoryHtml(toRichHtml(settings.foreword))}
      </section>
  `;
  }

  years.forEach((year) => {
    const age = Number(year) - birthYear;
    const yearMemories = memories[year] || [];

    bookHtml += `
      <section class="year-chapter">
        <h2>${year} - Age ${age}</h2>
    `;

    yearMemories.forEach((memory) => {
      const content = memory.html || `<p>${escapeHtml(memory.text || "")}</p>`;
      bookHtml += `
        <article class="memory">
          ${cleanMemoryHtml(content)}
        </article>
      `;
    });

    bookHtml += `</section>`;
  });

  // The afterword, if one has been written, closes the book — its own
  // page at the very end, after every year.
  if (settings.afterword && settings.afterword.trim()) {
    bookHtml += `
      <section class="foreword-chapter">
        <h2>Afterword</h2>
        ${cleanMemoryHtml(toRichHtml(settings.afterword))}
      </section>
  `;
  }

  bookHtml += `
    </body>
    </html>
  `;

  const bookWindow = window.open("", "_blank");
  bookWindow.document.open();
  bookWindow.document.write(bookHtml);
  bookWindow.document.close();
}

async function resetMeWall() {
  const confirmed = confirm(
    "This will clear this browser's MyLifeWall data. Export a backup first if you want to keep it."
  );

  if (!confirmed) return;

  localStorage.removeItem(settingsKey);
  localStorage.removeItem(memoryKey); // clears any leftover pre-migration data
  try {
    await idbRemoveMemories();
  } catch (error) {
    console.error("Could not clear stored memories:", error);
  }

  settings = {};
  memories = {};
  selectedYear = null;
  draftMemory = null;

  wall.classList.add("hidden");
  yearView.classList.add("hidden");
  setWallExtrasVisible(false);
  document.getElementById("infoBackButton").classList.add("hidden");
  setHomeArtVisible(false);
  setupView.classList.remove("hidden");
}

function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

function loadSettings() {
  const saved = localStorage.getItem(settingsKey);
  if (!saved) return {};

  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

// Settings (name, birth date) are tiny and stay in localStorage — no
// reason to complicate something that small. Photos are the problem, so
// only memories (which contain the photos) move to IndexedDB, which has a
// far higher ceiling, generally tied to free disk space, rather than
// localStorage's fixed ~5–10MB-per-site cap.
const idbName = "mewall_db";
const idbStoreName = "memories";

function openMemoriesDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(idbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(idbStoreName)) {
        db.createObjectStore(idbStoreName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGetMemories() {
  const db = await openMemoriesDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(idbStoreName, "readonly");
    const request = tx.objectStore(idbStoreName).get(memoryKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSetMemories(value) {
  const db = await openMemoriesDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(idbStoreName, "readwrite");
    tx.objectStore(idbStoreName).put(value, memoryKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbRemoveMemories() {
  const db = await openMemoriesDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(idbStoreName, "readwrite");
    tx.objectStore(idbStoreName).delete(memoryKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function saveMemories() {
  try {
    await idbSetMemories(memories);
    return true;
  } catch (error) {
    // IndexedDB has a far higher ceiling than localStorage did, but it
    // isn't infinite — this device could still genuinely be out of disk
    // space. Report it instead of losing the save silently.
    console.error("Could not save memories:", error);
    return false;
  }
}

async function loadMemories() {
  try {
    const saved = await idbGetMemories();
    if (saved) return saved;

    // One-time migration: anyone who used the app before this change has
    // their memories sitting in the old localStorage key. Move it across
    // automatically so nothing is lost, then clear the old copy to free up
    // the tight localStorage quota it was eating into.
    const legacy = localStorage.getItem(memoryKey);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        await idbSetMemories(parsed);
        localStorage.removeItem(memoryKey);
        console.log("Migrated existing memories from localStorage to IndexedDB.");
        return parsed;
      } catch (migrationError) {
        console.error("Could not migrate legacy memories:", migrationError);
      }
    }

    return {};
  } catch (error) {
    console.error("Could not load memories from storage:", error);
    return {};
  }
}

function formatDate(value) {
  if (!value) return "Recorded";

  const date = new Date(value);
  return `Recorded ${date.toLocaleDateString()}`;
}

function formatShortDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString();
}

function cleanMemoryHtml(html) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

startButton.addEventListener("click", startMeWall);
backButton.addEventListener("click", showWall);
document.getElementById("infoBackButton").addEventListener("click", showWall);
showEditorButton.addEventListener("click", addNewMemoryCard);

ownerName.addEventListener("click", () => {
  // Only meaningful once a wall exists — on the setup screen the name
  // field is right there anyway.
  if (settings.birthYear) changeName();
});

// A year's own title works the same way as Notes — saves itself a
// moment after typing stops.
let yearTitleSaveTimeout = null;
yearCustomTitleInput.addEventListener("input", () => {
  clearTimeout(yearTitleSaveTimeout);
  yearTitleSaveTimeout = setTimeout(() => {
    if (selectedYear === null) return;
    if (!settings.yearTitles) settings.yearTitles = {};
    settings.yearTitles[selectedYear] = yearCustomTitleInput.value.trim();
    saveSettings();
  }, 600);
});

ownerName.addEventListener("click", () => {
  // Only meaningful once a wall exists — on the setup screen the name
  // field is right there anyway.
  if (settings.birthYear) changeName();
});

titleHome.addEventListener("click", () => {
  if (settings.birthYear) showWall();
});

hamburgerMenuButton.addEventListener("click", () => showInfoPage("pageMenu"));

document.getElementById("menuChangeNameButton").addEventListener("click", changeName);
document.getElementById("menuChangeBirthDateButton").addEventListener("click", changeBirthDate);

document.getElementById("referFriendButton").addEventListener("click", () => {
  const senderName = settings.name && settings.name.trim() ? settings.name.trim() : "";

  const subject = "You've got to see this — My Life Wall";
  const body =
    "Hi,\n\n" +
    "I wanted to share something with you, an app called My Life Wall. It's a beautifully simple way to record the story of your life, one year at a time. Click a year, write down what you remember, add photos if you like, and slowly build up a private wall of memories you can turn into a printed keepsake book whenever you're ready.\n\n" +
    "I've been using it myself and thought you might enjoy it too.\n\n" +
    "Have a look here: https://my-life-wall.pages.dev\n\n" +
    (senderName ? senderName : "");

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoUrl;
});

actionImportBackup.addEventListener("click", () => importInput.click());
actionExportBackup.addEventListener("click", exportLife);
actionForeword.addEventListener("click", () => showInfoPage("pageForeword"));
actionContents.addEventListener("click", () => showInfoPage("pageContents"));
actionAfterword.addEventListener("click", () => showInfoPage("pageAfterword"));
actionCreateBook.addEventListener("click", createLifeBook);
actionBookCover.addEventListener("click", () => showInfoPage("pageBookCover"));

document.getElementById("saveBookCoverButton").addEventListener("click", () => {
  settings.bookCoverTitle = document.getElementById("bookCoverTitleInput").value.trim();
  settings.bookCoverSubtitle = document.getElementById("bookCoverSubtitleInput").value.trim();
  saveSettings();
  const status = document.getElementById("bookCoverStatus");
  status.classList.remove("hidden");
  setTimeout(() => status.classList.add("hidden"), 2500);
});

// Jump-to-top / jump-to-bottom now live inside the floating right column
// alongside the formatting tools, rather than as a separate widget.
const jumpTopButton = document.getElementById("jumpTopButton");
const jumpBottomButton = document.getElementById("jumpBottomButton");

if (jumpTopButton) {
  jumpTopButton.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

if (jumpBottomButton) {
  jumpBottomButton.addEventListener("click", () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  });
}

// ------------------------------------------------------------------
// Floating columns — left column (Home Wall / start a new memory) and
// right column (formatting, photo, audio, jump-to-top/bottom) both stay
// visible the whole time you're on a story page now, since every
// memory is permanently editable — there's no separate "reading" state
// left to keep them clean for.
// ------------------------------------------------------------------
// Foreword/Afterword/Notes get the same floating columns as a story page
// (Home button, formatting toolbar, mic) — whichever of the three is
// currently visible, if any.
function getProseFloatSection() {
  return [pageForeword, pageAfterword, pageNotes].find(
    section => !section.classList.contains("hidden")
  );
}

function updateFloatColumns() {
  const inStoryView = !yearView.classList.contains("hidden");
  const proseSection = getProseFloatSection();
  const showFloatCols = inStoryView || !!proseSection;

  floatColLeft.classList.toggle("visible", showFloatCols);
  floatColRight.classList.toggle("visible", showFloatCols);

  // "New Memory" only makes sense on a story page — Foreword/Afterword/
  // Notes get the Home button only.
  showEditorButton.classList.toggle("hidden", !inStoryView);

  // Photo tools don't apply outside a memory card either (see .prose-mode
  // in style.css). The record button's own title just follows along —
  // "Record memory" only makes sense in story view.
  floatColRight.classList.toggle("prose-mode", !!proseSection);
  recordAudioButton.title = inStoryView ? "Record memory" : "Record and transcribe";

  if (!showFloatCols) textStylePanel.classList.add("hidden");

  if (showFloatCols) positionLeftFloatColumn();
}

// Kept as the function name other code already calls into (opening a
// year, saving a memory, etc.) — it now drives the floating columns
// instead of the old scroll-jump widget.
function updateScrollJumpVisibility() {
  updateFloatColumns();
}

// ------------------------------------------------------------------
// Measures the real, rendered position of two landmarks and centres the
// Home Wall / New Memory buttons in the gap between them. On a story page
// that's the top of the story card and the bottom of the year-title
// field; on Foreword/Afterword/Notes it's the top of that page and the
// bottom of its own hint paragraph — same idea (the space above the
// actual writing area), applied to whichever is currently on screen. This
// replaces guessed pixel numbers entirely: the distance from the top of
// the screen changes depending on how much the header above it wraps,
// which varies with screen width and aspect ratio, so no fixed number (or
// simple percentage) can get this right on every screen. Measuring the
// actual rendered positions does.
// ------------------------------------------------------------------
function positionLeftFloatColumn() {
  let topEl, bottomEl;

  if (!yearView.classList.contains("hidden")) {
    topEl = yearView;
    bottomEl = yearCustomTitleInput;
  } else {
    const proseSection = getProseFloatSection();
    if (!proseSection) return;
    topEl = proseSection;
    bottomEl = proseSection.querySelector(".foreword-hint");
  }

  const cardTop = topEl.getBoundingClientRect().top;
  const fieldBottom = bottomEl.getBoundingClientRect().bottom;
  const gapHeight = fieldBottom - cardTop;
  const buttonBlockHeight = floatColLeft.offsetHeight;

  // Centred in that gap, but never pushed above the card's own top edge
  // even if the gap is unusually short on some screen.
  const centredTop = cardTop + (gapHeight - buttonBlockHeight) / 2;
  floatColLeft.style.top = `${Math.max(cardTop, centredTop)}px`;
}

let positionResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(positionResizeTimer);
  positionResizeTimer = setTimeout(positionLeftFloatColumn, 100);
});

menuBar.addEventListener("click", event => {
  const item = event.target.closest(".menu-item");
  if (!item) return;

  const page = item.dataset.page;
  if (page === "home") {
    showWall();
  } else {
    showInfoPage(page);
  }
});

memoryList.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;

  const index = Number(button.dataset.index);

  if (button.dataset.action === "delete") deleteMemory(index);
});

recordAudioButton.addEventListener("click", startRecording);
stopRecordingButton.addEventListener("click", stopRecording);

insertPhotoButton.addEventListener("click", addPhoto);

photoInput.addEventListener("change", event => {
  insertPhoto(event.target.files[0]);
  photoInput.value = "";
});

smallPhotoButton.addEventListener("click", () => setPhotoSize("35%"));
mediumPhotoButton.addEventListener("click", () => setPhotoSize("60%"));
largePhotoButton.addEventListener("click", () => setPhotoSize("100%"));
removePhotoButton.addEventListener("click", removePhoto);

importInput.addEventListener("change", importLife);

if (resetButton) {
  resetButton.addEventListener("click", resetMeWall);
}

initialise();
