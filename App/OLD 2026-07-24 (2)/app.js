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
let editingMemoryIndex = null;
let mediaRecorder = null;
let audioChunks = [];
let editor = null;

const setupView = document.getElementById("setupView");
const nameInput = document.getElementById("nameInput");
const birthDateInput = document.getElementById("birthDateInput");
const ownerName = document.getElementById("ownerName");
const ownerSubtitle = document.getElementById("ownerSubtitle");
const ownerPhotoButton = document.getElementById("ownerPhotoButton");
const ownerPhotoImg = document.getElementById("ownerPhotoImg");
const ownerPhotoPlaceholder = document.getElementById("ownerPhotoPlaceholder");
const ownerPhotoInput = document.getElementById("ownerPhotoInput");
const ownerPhotoRemove = document.getElementById("ownerPhotoRemove");
const ownerPhotoWrap = document.querySelector(".owner-photo-wrap");
const startButton = document.getElementById("startButton");

const wall = document.getElementById("wall");
const menuBar = document.getElementById("menuBar");
const yearView = document.getElementById("yearView");
const yearTitle = document.getElementById("yearTitle");
const yearAge = document.getElementById("yearAge");
const backButton = document.getElementById("backButton");

const keepMemoryButton = document.getElementById("keepMemoryButton");
const showEditorButton = document.getElementById("showEditorButton");
const cancelMemoryButton = document.getElementById("cancelMemoryButton");
const memoryEditor = document.getElementById("memoryEditor");
const memoryList = document.getElementById("memoryList");
const memoriesHeading = document.getElementById("memoriesHeading");
const forewordText = document.getElementById("forewordText");
const forewordStatus = document.getElementById("forewordStatus");
const afterwordText = document.getElementById("afterwordText");
const afterwordStatus = document.getElementById("afterwordStatus");
const notesText = document.getElementById("notesText");
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

const lifeTools = document.getElementById("lifeTools");
const exportButton = document.getElementById("exportButton");
const importInput = document.getElementById("importInput");
const resetButton = document.getElementById("resetButton");
const lifeBookButton = document.getElementById("lifeBookButton");

function setupEditor() {
  editor = new Editor({
    element: document.querySelector("#tipTapEditor"),
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
          insertPhoto(image);
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
          insertPhoto(file);
          return true;
        }

        return false;
      }
    }
  });

  setupFormatToolbar();
}

// The Notepad-style formatting bar: paragraph/heading dropdown, bold,
// italic, strikethrough, and a font dropdown limited to fonts that ship
// with every mainstream device — no external font loading.
function setupFormatToolbar() {
  const headingSelect = document.getElementById("headingSelect");
  const fontSelect = document.getElementById("fontSelect");
  const sizeSelect = document.getElementById("sizeSelect");
  const boldButton = document.getElementById("boldButton");
  const italicButton = document.getElementById("italicButton");
  const strikeButton = document.getElementById("strikeButton");
  const linkButton = document.getElementById("linkButton");
  const alignLeftButton = document.getElementById("alignLeftButton");
  const alignCenterButton = document.getElementById("alignCenterButton");
  const alignRightButton = document.getElementById("alignRightButton");
  const alignJustifyButton = document.getElementById("alignJustifyButton");

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

  // Keep the dropdowns and button states matching wherever the cursor is.
  editor.on("selectionUpdate", () => {
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
    // being true wiped out a perfectly good tracked position). The only
    // time this needs resetting is switching to a different memory
    // entirely, which showEditor()/editMemory() already handle directly.
  });
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

function showWall() {
  setupView.classList.add("hidden");
  yearView.classList.add("hidden");
  hideInfoPages();
  wall.classList.remove("hidden");
  lifeTools.classList.remove("hidden");
  menuBar.classList.remove("hidden");
  updateOwnerHeader();
  createWall();
  setHomeArtVisible(true);
  updateScrollJumpVisibility();
}

// The name lives in one place — settings — and everything (the header,
// the Life Book title page) reads it from there. So adding or changing
// it here retroactively applies to every memory ever recorded; nothing
// is stamped per-story.
// The photo circle's size and position are computed live from three real
// rendered elements: it spans vertically from the top of the title to the
// bottom of the owner's name, and its centre sits horizontally halfway
// between the Home Wall button's left edge and the title's right edge.
// Fixed CSS values can't express that — it has to be measured after the
// header actually renders, and re-measured whenever it might have
// reflowed (a resize, a name change, first showing the wall).
function positionOwnerPhoto() {
  if (!menuBar || menuBar.classList.contains("hidden")) return;

  const h1 = document.querySelector(".header h1");
  const homeButton = document.querySelector('.menu-item[data-page="home"]');
  if (!h1 || !homeButton || !ownerName || !ownerPhotoWrap) return;

  const headerEl = document.querySelector(".header");
  const headerRect = headerEl.getBoundingClientRect();
  const h1Rect = h1.getBoundingClientRect();
  const nameRect = ownerName.getBoundingClientRect();
  const homeRect = homeButton.getBoundingClientRect();

  // Nothing has actually rendered yet (e.g. fonts still loading, or the
  // header is momentarily hidden) — bail rather than apply a bogus size.
  if (h1Rect.height === 0 || nameRect.height === 0) return;

  const top = h1Rect.top - headerRect.top;
  const bottom = nameRect.bottom - headerRect.top;
  const diameter = Math.max(40, bottom - top);

  const centerX = (homeRect.left + h1Rect.right) / 2 - headerRect.left;
  const left = centerX - diameter / 2;

  ownerPhotoWrap.style.top = `${top}px`;
  ownerPhotoWrap.style.left = `${left}px`;
  ownerPhotoWrap.style.width = `${diameter}px`;
  ownerPhotoWrap.style.height = `${diameter}px`;
}

let ownerPhotoResizeTimeout = null;
window.addEventListener("resize", () => {
  clearTimeout(ownerPhotoResizeTimeout);
  ownerPhotoResizeTimeout = setTimeout(positionOwnerPhoto, 150);
});

function updateOwnerHeader() {
  if (settings.name) {
    ownerName.textContent = settings.name;
    ownerName.classList.remove("owner-name-placeholder");
    ownerSubtitle.classList.remove("hidden");
  } else {
    ownerName.textContent = "+ Add your name";
    ownerName.classList.add("owner-name-placeholder");
    ownerSubtitle.classList.add("hidden");
  }
  ownerName.title = "Click to change the name on this Life Wall";
  updateOwnerPhoto();
  // Position depends on the name's rendered width/height, so it has to
  // run after the text above has actually been set.
  requestAnimationFrame(positionOwnerPhoto);
}

const AVATAR_MAX_DIMENSION = 480;

function updateOwnerPhoto() {
  if (settings.ownerPhoto) {
    ownerPhotoImg.src = settings.ownerPhoto;
    ownerPhotoImg.classList.remove("hidden");
    ownerPhotoPlaceholder.classList.add("hidden");
    ownerPhotoButton.classList.add("has-photo");
    ownerPhotoButton.title = "Click to change this photo";
    ownerPhotoRemove.classList.remove("hidden");
  } else {
    ownerPhotoImg.classList.add("hidden");
    ownerPhotoImg.removeAttribute("src");
    ownerPhotoPlaceholder.classList.remove("hidden");
    ownerPhotoButton.classList.remove("has-photo");
    ownerPhotoButton.title = "Click to add a photo";
    ownerPhotoRemove.classList.add("hidden");
  }
}

function setOwnerPhoto(file) {
  if (!file || !file.type.startsWith("image/")) return;

  // A small avatar never needs to be as large as a memory photo — a
  // smaller max dimension keeps it light without any visible loss at the
  // size it's actually displayed.
  compressImageFile(file, AVATAR_MAX_DIMENSION)
    .then(dataUrl => {
      settings.ownerPhoto = dataUrl;
      saveSettings();
      updateOwnerPhoto();
    })
    .catch(error => {
      console.error("Could not add photo:", error);
      alert("That photo couldn't be added. Please try a different one.");
    });
}

function removeOwnerPhoto() {
  settings.ownerPhoto = null;
  saveSettings();
  updateOwnerPhoto();
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

function hideInfoPages() {
  document.querySelectorAll(".info-page").forEach(page => page.classList.add("hidden"));
}

function showInfoPage(pageId) {
  setupView.classList.add("hidden");
  yearView.classList.add("hidden");
  wall.classList.add("hidden");
  lifeTools.classList.add("hidden");
  hideInfoPages();
  setHomeArtVisible(false);
  const page = document.getElementById(pageId);
  if (page) page.classList.remove("hidden");

  // The Foreword page is editable — load whatever's been saved so far.
  if (pageId === "pageForeword") {
    forewordText.value = settings.foreword || "";
    forewordStatus.classList.add("hidden");
  }

  if (pageId === "pageAfterword") {
    afterwordText.value = settings.afterword || "";
    afterwordStatus.classList.add("hidden");
  }

  if (pageId === "pageNotes") {
    notesText.value = settings.notes || "";
    notesStatus.classList.add("hidden");
  }

  if (pageId === "pageContents") {
    renderContentsPage();
  }
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

  wall.appendChild(createEdgeBrickRow("forewordBrick", "Foreword", "pageForeword", settings.foreword));

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

  wall.appendChild(createEdgeBrickRow("afterwordBrick", "Afterword", "pageAfterword", settings.afterword));
}

// Foreword/Afterword now live inside the wall's own frame, as a small
// (roughly 3.5-brick-wide) centred brick occupying a full row to itself —
// not a separate element floating outside the wall. Rebuilt fresh every
// time createWall() runs, so the glow always reflects current settings
// without needing to be updated separately elsewhere.
function createEdgeBrickRow(id, label, pageId, content) {
  const row = document.createElement("div");
  row.className = "brick-row edge-brick-row";

  const brick = document.createElement("button");
  brick.type = "button";
  brick.id = id;
  brick.className = "edge-brick";
  if (content && content.trim()) brick.classList.add("has-content");
  brick.textContent = label;
  brick.addEventListener("click", () => showInfoPage(pageId));

  row.appendChild(brick);
  return row;
}

// Rebuild the wall if the window is resized while it's visible, so the
// brick count always matches the space actually available.
let wallResizeTimeout = null;
window.addEventListener("resize", () => {
  if (wall.classList.contains("hidden")) return;
  clearTimeout(wallResizeTimeout);
  wallResizeTimeout = setTimeout(createWall, 150);
});

function createBrick(year, age) {
  const brick = document.createElement("button");
  brick.className = "brick";
  brick.setAttribute("aria-label", `${year}, age ${age}`);

  if (year === currentYear) brick.classList.add("current");
  if (year > currentYear) brick.classList.add("future");
  if (memories[year] && memories[year].length > 0) {
    brick.classList.add("has-memories");
  }

  brick.innerHTML = `
    <span class="year">${year}</span>
    <span class="age">Age ${age}</span>
  `;

  brick.addEventListener("click", () => openYear(year, age));

  return brick;
}

function openYear(year, age) {
  selectedYear = year;
  editingMemoryIndex = null;

  wall.classList.add("hidden");
  yearView.classList.remove("hidden");
  memoryEditor.classList.add("hidden");
  hideInfoPages();
  setHomeArtVisible(false);

  yearTitle.textContent = `${year}`;
  yearAge.textContent = `Age ${age}`;

  editor.commands.clearContent();
  keepMemoryButton.textContent = "Keep memory";

  renderMemories();

  updateScrollJumpVisibility();

  // If nothing has been remembered from this year yet, skip the empty-state
  // messaging and go straight to the entry field — no point making people
  // click through "Record your first memory" to reach an obvious next step.
  const yearMemories = memories[selectedYear] || [];
  if (yearMemories.length === 0) {
    showEditor();
  }
}

function showEditor() {
  editingMemoryIndex = null;
  editor.commands.clearContent();
  lastSelectedImagePos = null;
  keepMemoryButton.textContent = "Keep memory";
  memoryEditor.classList.remove("hidden");
  showEditorButton.classList.add("hidden");
  editor.commands.focus();
}

async function keepMemory() {
  const html = editor.getHTML();
  const plainText = editor.getText().trim();
  const hasImage = html.includes("<img");

  if (!plainText && !hasImage) {
    alert("Write something or add a photo before keeping this memory.");
    return;
  }

  if (selectedYear === null) return;

  if (!memories[selectedYear]) {
    memories[selectedYear] = [];
  }

  const isNewEntry = editingMemoryIndex === null;
  const previousEntry = isNewEntry ? null : { ...memories[selectedYear][editingMemoryIndex] };

  if (editingMemoryIndex !== null) {
    memories[selectedYear][editingMemoryIndex].html = html;
    memories[selectedYear][editingMemoryIndex].text = plainText;
    memories[selectedYear][editingMemoryIndex].updatedAt = new Date().toISOString();
  } else {
    memories[selectedYear].push({
      html,
      text: plainText,
      createdAt: new Date().toISOString(),
      updatedAt: null
    });
  }

  if (!(await saveMemories())) {
    // Undo the in-memory change so it matches what's actually stored,
    // rather than looking saved when it isn't.
    if (isNewEntry) {
      memories[selectedYear].pop();
      if (memories[selectedYear].length === 0) delete memories[selectedYear];
    } else if (previousEntry) {
      memories[selectedYear][editingMemoryIndex] = previousEntry;
    }

    alert(
      "This memory couldn't be saved — this device may be out of storage space. " +
      "Try removing or shrinking the photo, freeing up space on the device, " +
      "then keep the memory again."
    );
    return;
  }

  editor.commands.clearContent();
  editingMemoryIndex = null;
  keepMemoryButton.textContent = "Keep memory";
  memoryEditor.classList.add("hidden");

  renderMemories();
  createWall();
}

function editMemory(index) {
  const memory = memories[selectedYear][index];

  editingMemoryIndex = index;
  editor.commands.setContent(memory.html || `<p>${escapeHtml(memory.text || "")}</p>`);
  lastSelectedImagePos = null;
  ensureEditableEdges();
  keepMemoryButton.textContent = "Update memory";
  memoryEditor.classList.remove("hidden");
  editor.commands.focus();
  renderMemories();
  memoryEditor.scrollIntoView({ behavior: "smooth", block: "start" });
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

function renderMemories() {
  memoryList.innerHTML = "";

  const yearMemories = memories[selectedYear] || [];

  // The empty-state message is retired — years with no memories now go
  // straight to the entry field instead (see openYear). The "Memories"
  // heading only appears once there's something under it.
  emptyYear.classList.add("hidden");
  memoriesHeading.classList.toggle("hidden", yearMemories.length === 0);
  showEditorButton.textContent = yearMemories.length === 0
    ? "Record your first memory"
    : "Record another memory";

  // No point showing a "record a memory" button while the entry field is
  // already open right below it.
  showEditorButton.classList.toggle(
    "hidden",
    !memoryEditor.classList.contains("hidden")
  );

  if (yearMemories.length === 0) return;

  yearMemories.forEach((memory, index) => {
    // Skip the memory currently open in the editor below — otherwise it
    // shows up twice at once: once as a static card here, and again as
    // the live thing you're editing, which is exactly the "double vision"
    // confusion that was reported.
    if (editingMemoryIndex === index) return;

    const card = document.createElement("article");
    card.className = "memory-card";

    const dateText = memory.updatedAt
      ? `${formatDate(memory.createdAt)} · Updated ${formatShortDate(memory.updatedAt)}`
      : formatDate(memory.createdAt);

    const content = memory.html
      ? cleanMemoryHtml(memory.html)
      : `<p>${escapeHtml(memory.text || "")}</p>`;

    card.innerHTML = `
      <div class="memory-content">${content}</div>
      <small>${dateText}</small>
      <div class="memory-actions">
        <button type="button" data-action="edit" data-index="${index}">Edit</button>
        <button type="button" data-action="delete" data-index="${index}">Delete</button>
      </div>
    `;

    memoryList.appendChild(card);
  });
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
function ensureEditableEdges() {
  const doc = editor.state.doc;
  if (doc.childCount === 0) return;

  const paragraph = editor.schema.nodes.paragraph;
  if (!paragraph) return;

  const tr = editor.state.tr;
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
    editor.view.dispatch(tr);
  }
}

function insertPhoto(file) {
  if (!file || !file.type.startsWith("image/")) return;

  compressImageFile(file)
    .then(dataUrl => {
      editor.chain().focus().setImage({
        src: dataUrl,
        alt: "Memory photograph",
        width: DEFAULT_PHOTO_WIDTH
      }).run();
      ensureEditableEdges();

      // Make the just-inserted photo immediately usable with Small/
      // Medium/Large without requiring a re-click. Found by its (unique)
      // data URL rather than assuming a position, since the edge-guarantee
      // above may have shifted everything by inserting a paragraph before it.
      editor.state.doc.descendants((node, pos) => {
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

function setPhotoSize(width) {
  const node = lastSelectedImagePos !== null ? editor.state.doc.nodeAt(lastSelectedImagePos) : null;

  if (!node || node.type.name !== "image") {
    alert("Click a photo first, then choose a size.");
    return;
  }

  editor.chain().focus().setNodeSelection(lastSelectedImagePos).updateAttributes("image", {
    width
  }).run();
}

function removePhoto() {
  const node = lastSelectedImagePos !== null ? editor.state.doc.nodeAt(lastSelectedImagePos) : null;

  if (!node || node.type.name !== "image") {
    alert("Click a photo first, then choose Remove photo.");
    return;
  }

  const pos = lastSelectedImagePos;
  editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  lastSelectedImagePos = null;
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());

      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      await transcribeAudio(audioBlob);

      recordAudioButton.classList.remove("hidden");
      stopRecordingButton.classList.add("hidden");
      recordingStatus.classList.add("hidden");
    };

    mediaRecorder.start();

    recordAudioButton.classList.add("hidden");
    stopRecordingButton.classList.remove("hidden");
    recordingStatus.textContent = "Recording...";
    recordingStatus.classList.remove("hidden");
  } catch (error) {
    alert("Microphone access was not available.");
    console.error(error);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    recordingStatus.textContent = "Transcribing...";
    mediaRecorder.stop();
  }
}

async function transcribeAudio(audioBlob) {
  recordingStatus.textContent = "Transcribing...";

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
      alert("I couldn't preserve that memory just now. Please try again.");
      return;
    }

    const transcript = result.text || "";

    if (transcript.trim()) {
      editor.chain().focus().insertContent(`<p>${escapeHtml(transcript.trim())}</p>`).run();
    }
  } catch (error) {
    console.error(error);
    alert("The transcription service could not be reached.");
  } finally {
    recordingStatus.textContent = "Recording...";
  }
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
        <p>My Life Wall</p>
        <p>Every life has a story. This is mine.</p>
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
    const forewordParagraphs = settings.foreword
      .trim()
      .split(/\n+/)
      .map(paragraph => `<p>${escapeHtml(paragraph.trim())}</p>`)
      .join("\n");

    bookHtml += `
      <section class="foreword-chapter">
        <h2>Foreword</h2>
        ${forewordParagraphs}
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
    const afterwordParagraphs = settings.afterword
      .trim()
      .split(/\n+/)
      .map(paragraph => `<p>${escapeHtml(paragraph.trim())}</p>`)
      .join("\n");

    bookHtml += `
      <section class="foreword-chapter">
        <h2>Afterword</h2>
        ${afterwordParagraphs}
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
  editingMemoryIndex = null;

  wall.classList.add("hidden");
  yearView.classList.add("hidden");
  lifeTools.classList.add("hidden");
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
showEditorButton.addEventListener("click", showEditor);

document.getElementById("changeNameButton").addEventListener("click", changeName);

// The foreword lives in settings, so it's automatically included in
// export/import backups alongside the name and birth date. Its brick
// glow updates itself next time the wall renders — no need to touch it
// here, since the brick is rebuilt fresh every time anyway.
document.getElementById("saveForewordButton").addEventListener("click", () => {
  settings.foreword = forewordText.value.trim();
  saveSettings();
  forewordStatus.classList.remove("hidden");
  setTimeout(() => forewordStatus.classList.add("hidden"), 2500);
});

document.getElementById("saveAfterwordButton").addEventListener("click", () => {
  settings.afterword = afterwordText.value.trim();
  saveSettings();
  afterwordStatus.classList.remove("hidden");
  setTimeout(() => afterwordStatus.classList.add("hidden"), 2500);
});

// Notes is a running scratchpad, not a finished piece of writing like the
// foreword — it saves itself a moment after you stop typing, rather than
// waiting for a deliberate "Save" click.
let notesSaveTimeout = null;
notesText.addEventListener("input", () => {
  clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => {
    settings.notes = notesText.value.trim();
    saveSettings();
    notesStatus.classList.remove("hidden");
    setTimeout(() => notesStatus.classList.add("hidden"), 2000);
  }, 600);
});

ownerName.addEventListener("click", () => {
  // Only meaningful once a wall exists — on the setup screen the name
  // field is right there anyway.
  if (settings.birthYear) changeName();
});

ownerPhotoButton.addEventListener("click", () => ownerPhotoInput.click());

ownerPhotoImg.addEventListener("click", () => ownerPhotoInput.click());

ownerPhotoInput.addEventListener("change", event => {
  const file = event.target.files[0];
  setOwnerPhoto(file);
  ownerPhotoInput.value = "";
});

ownerPhotoRemove.addEventListener("click", event => {
  event.stopPropagation();
  const confirmed = confirm("Remove this photo?");
  if (confirmed) removeOwnerPhoto();
});

// Jump-to-top / jump-to-bottom buttons for long story pages. Wired
// defensively: if the buttons aren't in the HTML (e.g. a mismatched
// deploy), the app carries on without them rather than crashing —
// a decoration should never take down the whole app.
const scrollJump = document.getElementById("scrollJump");
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

function updateScrollJumpVisibility() {
  if (!scrollJump) return;
  // These buttons belong to the story view only — reading or writing a
  // long story is where the scrolling pain is. They never show on the
  // Home Wall or setup screens.
  const inStoryView = !yearView.classList.contains("hidden");
  const pageIsLong =
    document.documentElement.scrollHeight > window.innerHeight * 1.5;
  scrollJump.classList.toggle("hidden", !(inStoryView && pageIsLong));
}

if (scrollJump) {
  window.addEventListener("scroll", updateScrollJumpVisibility, { passive: true });
  window.addEventListener("resize", updateScrollJumpVisibility);
  // Content height also changes without scrolling or resizing — opening a
  // year, saving a memory, rebuilding the wall — so watch the page itself.
  new ResizeObserver(updateScrollJumpVisibility).observe(document.body);
  updateScrollJumpVisibility();
}

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

cancelMemoryButton.addEventListener("click", () => {
  editor.commands.clearContent();
  editingMemoryIndex = null;
  keepMemoryButton.textContent = "Keep memory";
  memoryEditor.classList.add("hidden");
  renderMemories();
});

keepMemoryButton.addEventListener("click", keepMemory);

memoryList.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;

  const index = Number(button.dataset.index);

  if (button.dataset.action === "edit") editMemory(index);
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

exportButton.addEventListener("click", exportLife);
importInput.addEventListener("change", importLife);

if (resetButton) {
  resetButton.addEventListener("click", resetMeWall);
}

if (lifeBookButton) {
  lifeBookButton.addEventListener("click", createLifeBook);
}

initialise();
