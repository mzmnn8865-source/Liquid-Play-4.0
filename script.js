/* =====================================================
   LiquidPlay - منطق اصلی (v4)
   ===================================================== */

(function () {
  "use strict";

  /* =====================================================
     ابزارهای کمکی
     ===================================================== */

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return (root || document).querySelectorAll(sel); }
  function on(el, ev, fn, opts) {
    if (el) el.addEventListener(ev, fn, opts);
  }
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }
  function fmtBytes(b) {
    if (!b) return "0 B";
    var k = 1024, u = ["B", "KB", "MB", "GB"];
    var i = Math.floor(Math.log(b) / Math.log(k));
    return (b / Math.pow(k, i)).toFixed(1) + " " + u[i];
  }
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function isVideoFile(f) {
    if (!f) return false;
    if ((f.type || "").indexOf("video/") === 0) return true;
    return /\.(mp4|webm|mkv|mov|avi|m4v|ogv|flv|3gp)$/i.test(f.name || "");
  }
  function isImageFile(f) {
    if (!f) return false;
    if ((f.type || "").indexOf("image/") === 0) return true;
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg|avif)$/i.test(f.name || "");
  }
  function saveLS(key, val) {
    try { localStorage.setItem("liquidplay." + key, JSON.stringify(val)); } catch (e) {}
  }
  function loadLS(key, def) {
    try {
      var raw = localStorage.getItem("liquidplay." + key);
      return raw ? JSON.parse(raw) : def;
    } catch (e) { return def; }
  }
  function hexToRgb(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
  }

  /* =====================================================
     توست
     ===================================================== */

  var toastWrap = $("toastWrap");
  function toast(msg, type, dur) {
    if (!toastWrap) return;
    type = type || "info";
    dur = dur || 2400;
    var t = document.createElement("div");
    t.className = "toast toast-" + type;
    t.textContent = msg;
    toastWrap.appendChild(t);
    setTimeout(function () {
      t.classList.add("removing");
      setTimeout(function () { t.remove(); }, 400);
    }, dur);
  }

  /* =====================================================
     پارسر زیرنویس
     ===================================================== */

  function parseSubtitle(text) {
    var lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var cues = [];
    var i = 0;

    if (lines[0] && lines[0].indexOf("WEBVTT") !== -1) {
      while (i < lines.length && lines[i].trim() !== "") i++;
    }

    while (i < lines.length) {
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i >= lines.length) break;

      if (/^\d+$/.test(lines[i].trim())) i++;
      if (i >= lines.length) break;

      var m = lines[i].match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
      if (!m) { i++; continue; }

      var start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
      var end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
      i++;

      var textLines = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i].trim());
        i++;
      }
      cues.push({ start: start, end: end, text: textLines.join("\n") });
    }
    return cues;
  }

  /* =====================================================
     اپلیکیشن
     ===================================================== */

  var App = {
    playlist: [],
    gallery: [],
    currentIndex: -1,
    bookmarks: {},
    notes: {},
    history: [],
    subsByFile: {},
    currentCues: [],
    currentCueIdx: -1,
    settings: null,
    ab: { a: null, b: null },
    sleepTimer: null,
    sleepEnd: false,
    seeking: false,
    hudTimer: null,
    hudVisible: true,
    miniMode: false,
    suppressNextClick: false,
    dom: {},

    /* =============================================
       init
       ============================================= */
    init: function () {
      this.cacheDom();
      this.loadState();
      this.applySettings();
      this.bindFsGate();
      this.bindRotate();
      this.bindTopbar();
      this.bindSidebar();
      this.bindVideo();
      this.bindHud();
      this.bindTimeline();
      this.bindHudSettings();
      this.bindSubtitlePane();
      this.bindToolsPane();
      this.bindAppearancePane();
      this.bindGallery();
      this.bindUpload();
      this.bindPhotoViewer();
      this.bindModals();
      this.bindKeyboard();
      this.bindGestures();
      this.showView("upload");
      this.applyThemeAuto();
      console.log("LiquidPlay v4 ready");
    },

    /* =============================================
       cacheDom
       ============================================= */
    cacheDom: function () {
      var ids = [
        "rotatePrompt", "rotateLockBtn",
        "fsGate", "fsEnterBtn", "fsSkipBtn",
        "app", "topbar", "menuBtn", "galleryBtn", "uploadBtn", "themeBtn",
        "main", "viewPlayer", "viewGallery", "viewUpload",
        "videoStage", "videoPlayer", "subtitleLayer", "pauseBlur", "speedBadge",
        "gestureIndicator", "gestureIcon", "gestureValue",
        "hud", "hudTitle", "hudSubtitle", "hudMiniBtn", "hudCloseBtn",
        "hudCenterPlay", "hudCenterIcon",
        "hudTimeCurrent", "hudTimeline", "htBuffer", "htProgress", "htAB", "htMarks", "htThumb",
        "htPreview", "htPreviewCanvas", "htPreviewTime", "hudTimeTotal",
        "hudRewind", "hudPlay", "hudPlayIcon", "hudForward", "hudPrev", "hudNext",
        "hudSubtitle", "hudSettings", "hudFullscreen", "hudFsIcon",
        "hsClose", "hsTabs",
        "speedChips", "volSlider", "volVal",
        "loopToggle", "autoNextToggle", "rememberToggle",
        "abSetA", "abSetB", "abClear", "sleepChips",
        "subEnableToggle", "loadSubBtn", "subFontSelect",
        "subSizeSlider", "subSizeVal", "subWeightSlider", "subWeightVal",
        "subColorInput", "subAutoContrastToggle", "subBgToggle", "subBgColorInput",
        "subBgOpacitySlider", "subBgOpacityVal", "subRadiusSlider", "subRadiusVal",
        "subPosSlider", "subPosVal", "subPreview",
        "toolScreenshot", "toolBookmark", "toolNote", "toolPip", "toolRotate", "toolMirror", "toolFilters", "toolShortcuts",
        "themeChips", "glassOpSlider", "glassOpVal", "blurSlider", "blurVal", "reduceMotionToggle",
        "exportSettingsBtn", "importSettingsBtn", "resetSettingsBtn",
        "sidebar", "sbTabs", "sidebarClose", "sbSearch", "sbSort", "sbList", "sbCount", "sbClear", "sidebarOverlay",
        "gallerySlideBtn", "gallerySort", "galleryGrid", "galleryEmpty", "galleryAddBtn",
        "uploadArea", "pickVideoBtn", "pickImageBtn", "pickFolderBtn",
        "photoViewer", "pvBackdrop", "pvName", "pvZoomIn", "pvZoomOut", "pvRotate",
        "pvReset", "pvDownload", "pvClose", "pvStage", "pvImg", "pvPrev", "pvNext",
        "bookmarkModal", "bookmarkNameInput", "bookmarkTimeLabel", "bookmarkSaveBtn",
        "noteModal", "noteTextInput", "noteTimeLabel", "noteSaveBtn",
        "screenshotModal", "screenshotPreview", "screenshotDownloadBtn", "screenshotCopyBtn",
        "shortcutsModal", "filtersModal",
        "fBriVal", "fBrightness", "fConVal", "fContrast", "fSatVal", "fSaturate",
        "fHueVal", "fHue", "fBlurVal", "fBlur", "resetFiltersBtn",
        "videoInput", "imageInput", "folderInput", "subtitleInput", "importInput"
      ];
      var self = this;
      ids.forEach(function (id) { self.dom[id] = $(id); });
      this.dom.hudSettingsEl = $("#hudSettings");
    },

    /* =============================================
       State
       ============================================= */
    loadState: function () {
      var def = {
        theme: "dark",
        glassOpacity: 70,
        blurIntensity: 8,
        reduceMotion: false,
        defaultVolume: 1,
        defaultSpeed: 1,
        loop: false,
        autoNext: true,
        rememberProgress: true,
        subEnabled: true,
        subFont: "Vazirmatn, sans-serif",
        subSize: 20,
        subWeight: 700,
        subColor: "#ffffff",
        subAutoContrast: false,
        subBg: true,
        subBgColor: "#000000",
        subBgOpacity: 80,
        subRadius: 8,
        subPos: 14
      };
      this.settings = Object.assign({}, def, loadLS("settings", {}));
      this.bookmarks = loadLS("bookmarks", {});
      this.notes = loadLS("notes", {});
      this.history = loadLS("history", []);
    },

    saveSettings: function () { saveLS("settings", this.settings); },

    /* =============================================
       Apply
       ============================================= */
    applySettings: function () {
      var s = this.settings;
      var root = document.documentElement;

      root.style.setProperty("--glass-alpha", (s.glassOpacity / 100).toFixed(2));
      root.style.setProperty("--blur", s.blurIntensity + "px");
      root.style.setProperty("--sub-size", s.subSize + "px");
      root.style.setProperty("--sub-weight", s.subWeight);
      root.style.setProperty("--sub-font", s.subFont);
      root.style.setProperty("--sub-color", s.subColor);
      root.style.setProperty("--sub-bg-op", (s.subBgOpacity / 100).toFixed(2));
      root.style.setProperty("--sub-radius", s.subRadius + "px");

      document.body.classList.toggle("reduce-motion", !!s.reduceMotion);

      this.setTheme(s.theme, true);
      this.syncUI();
    },

    syncUI: function () {
      var s = this.settings;

      $$("#themeChips button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.theme === s.theme);
      });
      if (this.dom.glassOpSlider) this.dom.glassOpSlider.value = s.glassOpacity;
      if (this.dom.glassOpVal) this.dom.glassOpVal.textContent = s.glassOpacity + "%";
      if (this.dom.blurSlider) this.dom.blurSlider.value = s.blurIntensity;
      if (this.dom.blurVal) this.dom.blurVal.textContent = s.blurIntensity + "px";
      if (this.dom.reduceMotionToggle) this.dom.reduceMotionToggle.checked = !!s.reduceMotion;
      if (this.dom.volSlider) this.dom.volSlider.value = s.defaultVolume;
      if (this.dom.volVal) this.dom.volVal.textContent = Math.round(s.defaultVolume * 100) + "%";
      if (this.dom.loopToggle) this.dom.loopToggle.checked = !!s.loop;
      if (this.dom.autoNextToggle) this.dom.autoNextToggle.checked = !!s.autoNext;
      if (this.dom.rememberToggle) this.dom.rememberToggle.checked = !!s.rememberProgress;
      if (this.dom.subEnableToggle) this.dom.subEnableToggle.checked = !!s.subEnabled;
      if (this.dom.subFontSelect) this.dom.subFontSelect.value = s.subFont;
      if (this.dom.subSizeSlider) this.dom.subSizeSlider.value = s.subSize;
      if (this.dom.subSizeVal) this.dom.subSizeVal.textContent = s.subSize;
      if (this.dom.subWeightSlider) this.dom.subWeightSlider.value = s.subWeight;
      if (this.dom.subWeightVal) this.dom.subWeightVal.textContent = s.subWeight;
      if (this.dom.subColorInput) this.dom.subColorInput.value = s.subColor;
      if (this.dom.subAutoContrastToggle) this.dom.subAutoContrastToggle.checked = !!s.subAutoContrast;
      if (this.dom.subBgToggle) this.dom.subBgToggle.checked = !!s.subBg;
      if (this.dom.subBgColorInput) this.dom.subBgColorInput.value = s.subBgColor;
      if (this.dom.subBgOpacitySlider) this.dom.subBgOpacitySlider.value = s.subBgOpacity;
      if (this.dom.subBgOpacityVal) this.dom.subBgOpacityVal.textContent = s.subBgOpacity + "%";
      if (this.dom.subRadiusSlider) this.dom.subRadiusSlider.value = s.subRadius;
      if (this.dom.subRadiusVal) this.dom.subRadiusVal.textContent = s.subRadius;
      if (this.dom.subPosSlider) this.dom.subPosSlider.value = s.subPos;
      if (this.dom.subPosVal) this.dom.subPosVal.textContent = s.subPos;

      $$("#speedChips button").forEach(function (b) {
        b.classList.toggle("active", parseFloat(b.dataset.speed) === s.defaultSpeed);
      });

      this.applySubtitleStyleVars();
      this.updateSubPreview();
    },

    setTheme: function (mode, silent) {
      this.settings.theme = mode;
      var effective = mode;
      if (mode === "auto") {
        var h = new Date().getHours();
        effective = (h >= 7 && h < 19) ? "light" : "dark";
      }
      document.body.setAttribute("data-theme", effective);
      if (!silent) saveLS("settings", this.settings);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", effective === "dark" ? "#0d1117" : "#f6f8fa");
    },

    applyThemeAuto: function () {
      var self = this;
      setInterval(function () {
        if (self.settings.theme === "auto") self.setTheme("auto", true);
      }, 60000);
    },

    /* =============================================
       FS Gate
       ============================================= */
    bindFsGate: function () {
      var self = this;
      function hideGate() {
        if (self.dom.fsGate) {
          self.dom.fsGate.classList.add("hide");
          setTimeout(function () {
            if (self.dom.fsGate) self.dom.fsGate.classList.add("hidden");
          }, 500);
        }
      }

      on(this.dom.fsEnterBtn, "click", function () {
        var el = document.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        var p = null;
        if (req) {
          try { p = req.call(el); } catch (e) {}
        }
        var lock = function () {
          try {
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock("landscape").catch(function () {});
            }
          } catch (e) {}
        };
        if (p && p.then) p.then(lock).catch(lock);
        else lock();
        hideGate();
      });

      on(this.dom.fsSkipBtn, "click", hideGate);
    },

    /* =============================================
       Rotate Button
       ============================================= */
    bindRotate: function () {
      var self = this;
      on(this.dom.rotateLockBtn, "click", function () {
        var lockFn = function () {
          try {
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock("landscape").then(function () {
                toast("گوشی چرخید", "success");
              }).catch(function () {
                toast("چرخش خودکار پشتیبانی نمی‌شه. دستی بچرخون.", "info", 3200);
              });
            } else {
              toast("مرورگرت چرخش خودکار رو پشتیبانی نمی‌کنه. دستی بچرخون.", "info", 3200);
            }
          } catch (e) {
            toast("دستی گوشی رو بچرخون", "info", 3000);
          }
        };

        // طبق استاندارد، باید اول fullscreen بشه
        var el = document.documentElement;
        var isFs = document.fullscreenElement || document.webkitFullscreenElement;
        if (!isFs) {
          var req = el.requestFullscreen || el.webkitRequestFullscreen;
          if (req) {
            try {
              var p = req.call(el);
              if (p && p.then) p.then(lockFn).catch(lockFn);
              else lockFn();
              return;
            } catch (e) {
              lockFn();
              return;
            }
          }
        }
        lockFn();
      });
    },

    /* =============================================
       Topbar
       ============================================= */
    bindTopbar: function () {
      var self = this;

      on(this.dom.menuBtn, "click", function () { self.openSidebar(); });
      on(this.dom.uploadBtn, "click", function () { self.dom.videoInput.click(); });

      on(this.dom.galleryBtn, "click", function () {
        self.showView("gallery");
        self.renderGallery();
      });

      on(this.dom.themeBtn, "click", function () {
        var order = ["dark", "light", "auto"];
        var cur = self.settings.theme;
        var next = order[(order.indexOf(cur) + 1) % order.length];
        self.setTheme(next);
        self.syncUI();
        var names = { dark: "تاریک", light: "روشن", auto: "خودکار" };
        toast("تم: " + names[next], "info", 1400);
      });
    },

    showView: function (name) {
      $$(".view").forEach(function (v) { v.classList.remove("active"); });
      var el = $("view" + name.charAt(0).toUpperCase() + name.slice(1));
      if (el) el.classList.add("active");
    },

    /* =============================================
       Sidebar
       ============================================= */
    openSidebar: function () {
      this.dom.sidebar.classList.add("open");
      this.dom.sidebarOverlay.classList.add("show");
      this.renderSidebarList("playlist");
    },
    closeSidebar: function () {
      this.dom.sidebar.classList.remove("open");
      this.dom.sidebarOverlay.classList.remove("show");
    },

    bindSidebar: function () {
      var self = this;
      on(this.dom.sidebarClose, "click", function () { self.closeSidebar(); });
      on(this.dom.sidebarOverlay, "click", function () { self.closeSidebar(); });

      $$(".sb-tab", this.dom.sbTabs).forEach(function (t) {
        on(t, "click", function () {
          $$(".sb-tab", self.dom.sbTabs).forEach(function (x) { x.classList.remove("active"); });
          t.classList.add("active");
          self.renderSidebarList(t.dataset.tab);
        });
      });

      on(this.dom.sbSearch, "input", function () {
        var act = document.querySelector(".sb-tab.active");
        self.renderSidebarList(act ? act.dataset.tab : "playlist");
      });
      on(this.dom.sbSort, "change", function () {
        self.sortPlaylist(self.dom.sbSort.value);
      });
      on(this.dom.sbClear, "click", function () {
        if (!self.playlist.length) return;
        if (!confirm("همه ی فایل ها از لیست حذف بشن؟")) return;
        self.revokeAll();
        self.playlist = [];
        self.currentIndex = -1;
        self.dom.videoPlayer.removeAttribute("src");
        self.dom.videoPlayer.load();
        self.renderPlaylist();
        self.updateEmptyPlayer();
        toast("لیست پاک شد", "success");
      });
    },

    sortPlaylist: function (mode) {
      if (mode === "manual") { this.renderPlaylist(); return; }
      this.playlist.sort(function (a, b) {
        if (mode === "name") return (a.name || "").localeCompare(b.name || "", "fa");
        if (mode === "duration") return (b.duration || 0) - (a.duration || 0);
        if (mode === "size") return (b.size || 0) - (a.size || 0);
        return 0;
      });
      this.renderPlaylist();
    },

    renderPlaylist: function () {
      var self = this;
      var list = this.dom.sbList;
      if (!list) return;
      list.innerHTML = "";

      var q = (this.dom.sbSearch.value || "").trim().toLowerCase();
      var filtered = this.playlist.filter(function (p) {
        return (p.name || "").toLowerCase().indexOf(q) !== -1;
      });

      if (!filtered.length) {
        list.innerHTML = '<div class="empty-state"><p>' +
          (this.playlist.length ? "چیزی پیدا نشد" : "لیست خالیه") +
          '</p></div>';
        if (this.dom.sbCount) this.dom.sbCount.textContent = this.playlist.length + " فایل";
        return;
      }

      filtered.forEach(function (item) {
        var realIdx = self.playlist.indexOf(item);
        var el = document.createElement("div");
        el.className = "playlist-item" + (realIdx === self.currentIndex ? " active" : "");
        el.dataset.id = item.id;
        el.dataset.index = realIdx;

        var thumbHTML = item.thumb
          ? '<img src="' + item.thumb + '" alt="">'
          : '<span>' + (item.type === "image" ? "عکس" : "ویدیو") + '</span>';

        el.innerHTML =
          '<div class="playlist-thumb">' + thumbHTML + '</div>' +
          '<div class="playlist-info">' +
            '<span class="playlist-name">' + esc(item.name) + '</span>' +
            '<span class="playlist-meta">' +
              '<span>' + (item.duration ? fmtTime(item.duration) : "--:--") + '</span>' +
              '<span>' + fmtBytes(item.size) + '</span>' +
            '</span>' +
          '</div>';

        on(el, "click", function () {
          if (item.type === "video") {
            self.playIndex(realIdx);
            self.closeSidebar();
          } else {
            self.openPhotoByItem(item);
            self.closeSidebar();
          }
        });

        list.appendChild(el);
      });

      if (this.dom.sbCount) this.dom.sbCount.textContent = this.playlist.length + " فایل";
    },

    renderSidebarList: function (tab) {
      var self = this;
      if (tab === "playlist") { this.renderPlaylist(); return; }
      var list = this.dom.sbList;
      list.innerHTML = "";

      if (tab === "history") {
        if (!this.history.length) {
          list.innerHTML = '<div class="empty-state"><p>تاریخچه خالیه</p></div>';
          return;
        }
        this.history.slice().reverse().forEach(function (h) {
          var el = document.createElement("div");
          el.className = "playlist-item";
          el.innerHTML =
            '<div class="playlist-thumb"><span>ت</span></div>' +
            '<div class="playlist-info">' +
              '<span class="playlist-name">' + esc(h.name) + '</span>' +
              '<span class="playlist-meta"><span>' + esc(h.date || "") + '</span></span>' +
            '</div>';
          list.appendChild(el);
        });
      } else if (tab === "marks") {
        var cur = this.playlist[this.currentIndex];
        var arr = cur ? (this.bookmarks[cur.id] || []) : [];
        if (!arr.length) {
          list.innerHTML = '<div class="empty-state"><p>بوک مارکی نداری</p></div>';
          return;
        }
        arr.forEach(function (b) {
          var el = document.createElement("div");
          el.className = "playlist-item";
          el.innerHTML =
            '<div class="playlist-thumb"><span>ب</span></div>' +
            '<div class="playlist-info">' +
              '<span class="playlist-name">' + esc(b.name) + '</span>' +
              '<span class="playlist-meta"><span>' + fmtTime(b.time) + '</span></span>' +
            '</div>';
          on(el, "click", function () {
            var v = self.dom.videoPlayer;
            if (v && isFinite(v.duration)) v.currentTime = b.time;
            self.closeSidebar();
          });
          list.appendChild(el);
        });
      }
    },

    /* =============================================
       Upload
       ============================================= */
    bindUpload: function () {
      var self = this;
      on(this.dom.pickVideoBtn, "click", function () { self.dom.videoInput.click(); });
      on(this.dom.pickImageBtn, "click", function () { self.dom.imageInput.click(); });
      on(this.dom.pickFolderBtn, "click", function () { self.dom.folderInput.click(); });
      on(this.dom.galleryAddBtn, "click", function () { self.dom.imageInput.click(); });

      on(this.dom.videoInput, "change", function (e) { self.handleFiles(e.target.files, "video"); });
      on(this.dom.imageInput, "change", function (e) { self.handleFiles(e.target.files, "image"); });
      on(this.dom.folderInput, "change", function (e) { self.handleFiles(e.target.files, "auto"); });

      var dz = this.dom.uploadArea;
      if (!dz) return;

      ["dragenter", "dragover", "drop"].forEach(function (ev) {
        on(document, ev, function (e) { e.preventDefault(); e.stopPropagation(); });
      });
      on(document, "dragenter", function () { dz.classList.add("drag-active"); });
      on(document, "dragover", function () { dz.classList.add("drag-active"); });
      on(document, "dragleave", function (e) {
        if (e.clientX <= 0 || e.clientY <= 0 ||
            e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
          dz.classList.remove("drag-active");
        }
      });
      on(document, "drop", function (e) {
        dz.classList.remove("drag-active");
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) self.handleFiles(files, "auto");
      });
    },

    handleFiles: function (fileList, mode) {
      var self = this;
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;

      var addedV = 0, addedI = 0;

      files.forEach(function (file) {
        if (!file || !file.name) return;

        if (isVideoFile(file) && (mode === "video" || mode === "auto")) {
          var item = {
            id: uid(),
            file: file,
            url: URL.createObjectURL(file),
            name: file.name,
            size: file.size,
            duration: 0,
            thumb: null,
            type: "video"
          };
          self.playlist.push(item);
          self.generateThumb(item);
          addedV++;
        } else if (isImageFile(file) && (mode === "image" || mode === "auto")) {
          var img = {
            id: uid(),
            file: file,
            url: URL.createObjectURL(file),
            name: file.name,
            size: file.size,
            type: "image"
          };
          self.gallery.push(img);
          addedI++;
        }
      });

      if (addedV) {
        this.renderPlaylist();
        toast(addedV + " ویدیو اضافه شد", "success");
        if (this.currentIndex === -1) this.playIndex(0);
      }
      if (addedI) {
        this.renderGallery();
        toast(addedI + " عکس اضافه شد", "success");
        if (!addedV) {
          this.showView("gallery");
        }
      }
      if (!addedV && !addedI) toast("فایلی قابل اضافه کردن نبود", "error");

      this.dom.videoInput.value = "";
      this.dom.imageInput.value = "";
      this.dom.folderInput.value = "";
    },

    generateThumb: function (item) {
      var self = this;
      var v = document.createElement("video");
      v.src = item.url;
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";

      var done = false;
      function finish() {
        if (done) return;
        done = true;
        try {
          var c = document.createElement("canvas");
          c.width = 160;
          c.height = 90;
          c.getContext("2d").drawImage(v, 0, 0, 160, 90);
          item.thumb = c.toDataURL("image/jpeg", 0.6);
          self.renderPlaylist();
        } catch (e) {}
        try { v.remove(); } catch (e) {}
      }

      on(v, "loadedmetadata", function () {
        item.duration = v.duration || 0;
        self.renderPlaylist();
        try { v.currentTime = Math.min(1, (v.duration || 2) / 3); }
        catch (e) { finish(); }
      });
      on(v, "seeked", finish);
      on(v, "error", function () { try { v.remove(); } catch (e) {} });
      setTimeout(finish, 5000);
    },

    /* =============================================
       Video Player
       ============================================= */
    playIndex: function (idx) {
      if (idx < 0 || idx >= this.playlist.length) return;
      var item = this.playlist[idx];
      if (!item || item.type !== "video") return;

      this.currentIndex = idx;
      var v = this.dom.videoPlayer;
      v.src = item.url;
      v.load();
      v.playbackRate = this.settings.defaultSpeed || 1;
      v.volume = this.settings.defaultVolume;

      if (this.dom.hudTitle) this.dom.hudTitle.textContent = item.name;
      if (this.dom.hudSubtitle) this.dom.hudSubtitle.textContent = fmtBytes(item.size);

      this.showView("player");
      this.miniMode = false;
      this.dom.videoStage.classList.remove("mini-mode");

      this.history.push({
        id: item.id,
        name: item.name,
        date: new Date().toLocaleString("fa-IR")
      });
      if (this.history.length > 100) this.history.shift();
      saveLS("history", this.history);

      this.renderPlaylist();
      this.showHud(true);
      this.showCenterPlay(true);
      this.currentCues = this.subsByFile[item.id] || [];
      this.currentCueIdx = -1;
      if (this.dom.subtitleLayer) this.dom.subtitleLayer.innerHTML = "";
    },

    updateEmptyPlayer: function () {
      if (this.dom.hudTitle) this.dom.hudTitle.textContent = "فایلی انتخاب نشده";
      if (this.dom.hudSubtitle) this.dom.hudSubtitle.textContent = "";
    },

    bindVideo: function () {
      var self = this;
      var v = this.dom.videoPlayer;

      on(v, "loadedmetadata", function () {
        self.updateTimelineBuffer();
        self.updateTimeDisplay();
        var item = self.playlist[self.currentIndex];
        if (item && !item.duration) {
          item.duration = v.duration;
          self.renderPlaylist();
        }
        if (self.settings.rememberProgress && item) {
          var prog = loadLS("progress." + item.id, 0);
          if (prog > 2 && prog < v.duration - 2) v.currentTime = prog;
        }
      });

      on(v, "timeupdate", function () {
        self.updateTimeline();
        self.updateTimeDisplay();
        self.updateSubtitleCue();
        self.checkAB();
        if (self.settings.rememberProgress && v.currentTime > 2) {
          var item = self.playlist[self.currentIndex];
          if (item) saveLS("progress." + item.id, v.currentTime);
        }
      });

      on(v, "progress", function () { self.updateTimelineBuffer(); });

      on(v, "play", function () {
        self.setPlayIcon(true);
        self.showCenterPlay(false);
        self.hidePauseBlur();
        self.scheduleHudHide();
      });

      on(v, "pause", function () {
        self.setPlayIcon(false);
        if (!v.ended) {
          self.showCenterPlay(true);
          self.showPauseBlur();
        }
        self.showHud(true);
        self.cancelHudHide();
      });

      on(v, "ended", function () {
        self.setPlayIcon(false);
        self.hidePauseBlur();
        if (self.sleepEnd) {
          self.sleepEnd = false;
          toast("تایمر خواب: پایان ویدیو", "info");
          return;
        }
        if (self.settings.loop) {
          v.currentTime = 0;
          v.play().catch(function () {});
          return;
        }
        if (self.settings.autoNext && self.currentIndex < self.playlist.length - 1) {
          self.playIndex(self.currentIndex + 1);
        } else {
          self.showCenterPlay(true);
          self.showHud(true);
        }
      });

      on(v, "volumechange", function () {
        if (self.dom.volSlider) self.dom.volSlider.value = v.volume;
        if (self.dom.volVal) self.dom.volVal.textContent = Math.round(v.volume * 100) + "%";
      });

      on(v, "waiting", function () {
        if (self.dom.hudSubtitle) self.dom.hudSubtitle.textContent = "در حال بارگذاری...";
      });

      on(v, "playing", function () {
        var item = self.playlist[self.currentIndex];
        if (item && self.dom.hudSubtitle) self.dom.hudSubtitle.textContent = fmtBytes(item.size);
      });
    },

    /* =============================================
       HUD — با click (نه pointerdown)
       ============================================= */
    bindHud: function () {
      var self = this;

      function bindBtn(el, handler) {
        if (!el) return;
        on(el, "click", function (e) {
          e.stopPropagation();
          e.preventDefault();
          self.cancelHudHide();
          handler(e);
        });
      }

      bindBtn(this.dom.hudPlay, function () { self.togglePlay(); });
      bindBtn(this.dom.hudCenterPlay, function () { self.togglePlay(); });
      bindBtn(this.dom.hudRewind, function () {
        var v = self.dom.videoPlayer;
        v.currentTime = Math.max(0, v.currentTime - 10);
      });
      bindBtn(this.dom.hudForward, function () {
        var v = self.dom.videoPlayer;
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
      });
      bindBtn(this.dom.hudPrev, function () {
        if (self.currentIndex > 0) self.playIndex(self.currentIndex - 1);
      });
      bindBtn(this.dom.hudNext, function () {
        if (self.currentIndex < self.playlist.length - 1) self.playIndex(self.currentIndex + 1);
      });
      bindBtn(this.dom.hudClose, function () {
        var v = self.dom.videoPlayer;
        v.pause();
        v.removeAttribute("src");
        v.load();
        self.currentIndex = -1;
        self.updateEmptyPlayer();
        self.renderPlaylist();
        self.showView("upload");
      });
      bindBtn(this.dom.hudSubtitle, function () { self.toggleSubtitleQuick(); });
      bindBtn(this.dom.hudSettings, function () { self.openHudSettings(); });
      bindBtn(this.dom.hudFullscreen, function () { self.toggleFullscreen(); });
      bindBtn(this.dom.hudMiniBtn, function () { self.toggleMiniMode(); });

      // کلیک روی video stage برای toggle HUD
      on(this.dom.videoStage, "click", function (e) {
        // اگر روی دکمه یا پنل تنظیمات هست، نادیده بگیر
        if (e.target.closest(".hud-btn") ||
            e.target.closest(".hud-icon") ||
            e.target.closest(".hud-center-play") ||
            e.target.closest(".hs-tab") ||
            e.target.closest(".hs-tool") ||
            e.target.closest(".hs-chips button") ||
            e.target.closest(".hs-full-btn") ||
            e.target.closest(".hud-timeline") ||
            e.target.closest(".hud-settings.open") ||
            e.target.closest(".playlist-item") ||
            e.target.closest(".sw") ||
            e.target.closest("input") ||
            e.target.closest("select") ||
            e.target.closest("label")) {
          return;
        }
        if (self.suppressNextClick) {
          self.suppressNextClick = false;
          return;
        }
        if (self.hudVisible) self.hideHud();
        else self.showHud(true);
      });
    },

    showHud: function (autoHide) {
      this.hudVisible = true;
      if (this.dom.hud) this.dom.hud.setAttribute("data-state", "visible");
      if (autoHide && !this.dom.videoPlayer.paused) this.scheduleHudHide();
    },

    hideHud: function () {
      this.hudVisible = false;
      if (this.dom.hud) this.dom.hud.setAttribute("data-state", "hidden");
      this.showCenterPlay(false);
    },

    scheduleHudHide: function () {
      this.cancelHudHide();
      var self = this;
      this.hudTimer = setTimeout(function () {
        if (!self.dom.videoPlayer.paused) self.hideHud();
      }, 5000);
    },

    cancelHudHide: function () {
      if (this.hudTimer) {
        clearTimeout(this.hudTimer);
        this.hudTimer = null;
      }
    },

    showCenterPlay: function (show) {
      if (!this.dom.hudCenterPlay) return;
      if (show) this.dom.hudCenterPlay.classList.remove("hide");
      else this.dom.hudCenterPlay.classList.add("hide");
    },

    setPlayIcon: function (playing) {
      var svg = this.dom.hudPlayIcon;
      var svg2 = this.dom.hudCenterIcon;
      if (playing) {
        if (svg) svg.innerHTML = '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>';
        if (svg2) svg2.innerHTML = '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>';
      } else {
        if (svg) svg.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
        if (svg2) svg2.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
      }
    },

    togglePlay: function () {
      var v = this.dom.videoPlayer;
      if (!v.src) {
        if (this.playlist.length) this.playIndex(0);
        else toast("اول یه ویدیو انتخاب کن", "info");
        return;
      }
      if (v.paused) v.play().catch(function () {});
      else v.pause();
    },

    showPauseBlur: function () {
      if (this.dom.pauseBlur) this.dom.pauseBlur.classList.add("active");
    },
    hidePauseBlur: function () {
      if (this.dom.pauseBlur) this.dom.pauseBlur.classList.remove("active");
    },

    toggleMiniMode: function () {
      this.miniMode = !this.miniMode;
      this.dom.videoStage.classList.toggle("mini-mode", this.miniMode);
    },

    toggleFullscreen: function () {
      var el = this.dom.videoStage;
      var isFs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!isFs) {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          try {
            var p = req.call(el);
            if (p && p.catch) p.catch(function () {});
          } catch (e) {}
        }
        try {
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock("landscape").catch(function () {});
          }
        } catch (e) {}
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    },

    /* =============================================
       Timeline
       ============================================= */
    bindTimeline: function () {
      var self = this;
      var tl = this.dom.hudTimeline;
      if (!tl) return;
      var v = this.dom.videoPlayer;

      function seekFromEvent(clientX) {
        var rect = tl.getBoundingClientRect();
        var x = clamp(clientX - rect.left, 0, rect.width);
        var pct = x / rect.width;
        if (isFinite(v.duration)) v.currentTime = pct * v.duration;
      }

      on(tl, "pointerdown", function (e) {
        e.stopPropagation();
        self.seeking = true;
        tl.classList.add("dragging");
        self.cancelHudHide();
        try { tl.setPointerCapture(e.pointerId); } catch (er) {}
        seekFromEvent(e.clientX);
      });

      on(tl, "pointermove", function (e) {
        if (self.seeking) seekFromEvent(e.clientX);
        else self.showTimelinePreview(e.clientX);
      });

      on(tl, "pointerup", function (e) {
        if (self.seeking) {
          self.seeking = false;
          tl.classList.remove("dragging");
          self.scheduleHudHide();
        }
        try { tl.releasePointerCapture(e.pointerId); } catch (er) {}
      });

      on(tl, "pointercancel", function () {
        self.seeking = false;
        tl.classList.remove("dragging");
      });

      on(tl, "pointerleave", function () { self.hideTimelinePreview(); });
    },

    updateTimeline: function () {
      var v = this.dom.videoPlayer;
      if (!isFinite(v.duration) || !v.duration) return;
      var pct = (v.currentTime / v.duration) * 100;
      if (this.dom.htProgress) this.dom.htProgress.style.width = pct + "%";
      if (this.dom.htThumb) this.dom.htThumb.style.left = pct + "%";
      if (this.dom.htAB) this.updateABPosition();
    },

    updateTimelineBuffer: function () {
      var v = this.dom.videoPlayer;
      if (!v.buffered || !v.buffered.length || !isFinite(v.duration)) return;
      var end = 0;
      for (var i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) {
          end = v.buffered.end(i);
          break;
        }
      }
      if (this.dom.htBuffer) {
        this.dom.htBuffer.style.width = ((end / v.duration) * 100) + "%";
      }
    },

    updateTimeDisplay: function () {
      var v = this.dom.videoPlayer;
      if (this.dom.hudTimeCurrent) this.dom.hudTimeCurrent.textContent = fmtTime(v.currentTime);
      if (this.dom.hudTimeTotal) this.dom.hudTimeTotal.textContent = fmtTime(v.duration || 0);
    },

    showTimelinePreview: function (clientX) {
      var tl = this.dom.hudTimeline;
      var v = this.dom.videoPlayer;
      if (!isFinite(v.duration)) return;
      var prev = this.dom.htPreview;
      if (!prev) return;

      var rect = tl.getBoundingClientRect();
      var x = clamp(clientX - rect.left, 0, rect.width);
      var pct = x / rect.width;
      var time = pct * v.duration;

      var pw = prev.offsetWidth || 140;
      var left = x - pw / 2;
      left = clamp(left, 0, rect.width - pw);
      prev.style.left = (left + pw / 2) + "px";
      prev.classList.add("show");

      if (this.dom.htPreviewTime) this.dom.htPreviewTime.textContent = fmtTime(time);

      var canvas = this.dom.htPreviewCanvas;
      if (!canvas) return;
      var ctx = canvas.getContext("2d");

      if (!this._previewVideo) {
        this._previewVideo = document.createElement("video");
        this._previewVideo.muted = true;
        this._previewVideo.playsInline = true;
        this._previewVideo.preload = "auto";
      }
      var pv = this._previewVideo;
      if (pv.src !== v.src) pv.src = v.src;

      var draw = function () {
        try { ctx.drawImage(pv, 0, 0, canvas.width, canvas.height); } catch (e) {}
      };

      if (pv.readyState >= 2) {
        try { pv.currentTime = time; } catch (e) {}
        setTimeout(draw, 30);
      } else {
        on(pv, "loadeddata", function () {
          try { pv.currentTime = time; } catch (e) {}
          setTimeout(draw, 60);
        }, { once: true });
      }
    },

    hideTimelinePreview: function () {
      if (this.dom.htPreview) this.dom.htPreview.classList.remove("show");
    },

    /* =============================================
       HUD Settings
       ============================================= */
    openHudSettings: function () {
      this.dom.hudSettingsEl.classList.add("open");
      this.cancelHudHide();
    },
    closeHudSettings: function () {
      this.dom.hudSettingsEl.classList.remove("open");
      this.scheduleHudHide();
    },

    bindHudSettings: function () {
      var self = this;

      on(this.dom.hsClose, "click", function () { self.closeHudSettings(); });

      $$(".hs-tab", this.dom.hsTabs).forEach(function (t) {
        on(t, "click", function () {
          $$(".hs-tab", self.dom.hsTabs).forEach(function (x) { x.classList.remove("active"); });
          t.classList.add("active");
          $$(".hs-pane").forEach(function (p) { p.classList.remove("active"); });
          var pane = document.querySelector('.hs-pane[data-pane="' + t.dataset.tab + '"]');
          if (pane) pane.classList.add("active");
        });
      });

      $$("#speedChips button").forEach(function (b) {
        on(b, "click", function () {
          var s = parseFloat(b.dataset.speed);
          self.dom.videoPlayer.playbackRate = s;
          self.settings.defaultSpeed = s;
          self.saveSettings();
          $$("#speedChips button").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
        });
      });

      on(this.dom.volSlider, "input", function (e) {
        var v = parseFloat(e.target.value);
        self.dom.videoPlayer.volume = v;
        self.dom.videoPlayer.muted = false;
        self.settings.defaultVolume = v;
        if (self.dom.volVal) self.dom.volVal.textContent = Math.round(v * 100) + "%";
        self.saveSettings();
      });

      on(this.dom.loopToggle, "change", function (e) {
        self.settings.loop = e.target.checked;
        self.saveSettings();
      });
      on(this.dom.autoNextToggle, "change", function (e) {
        self.settings.autoNext = e.target.checked;
        self.saveSettings();
      });
      on(this.dom.rememberToggle, "change", function (e) {
        self.settings.rememberProgress = e.target.checked;
        self.saveSettings();
      });

      on(this.dom.abSetA, "click", function () {
        var v = self.dom.videoPlayer;
        self.ab.a = v.currentTime;
        self.dom.abSetA.classList.add("active");
        toast("نقطه A: " + fmtTime(self.ab.a), "info");
      });
      on(this.dom.abSetB, "click", function () {
        var v = self.dom.videoPlayer;
        if (self.ab.a === null) { toast("اول A رو ثبت کن", "error"); return; }
        self.ab.b = v.currentTime;
        if (self.ab.b <= self.ab.a) {
          var t = self.ab.a; self.ab.a = self.ab.b; self.ab.b = t;
        }
        self.dom.abSetB.classList.add("active");
        self.updateABPosition();
        toast("نقطه B: " + fmtTime(self.ab.b), "success");
      });
      on(this.dom.abClear, "click", function () {
        self.ab.a = null; self.ab.b = null;
        self.dom.abSetA.classList.remove("active");
        self.dom.abSetB.classList.remove("active");
        self.dom.htAB.classList.remove("show");
        toast("AB پاک شد", "info");
      });

      $$("#sleepChips button").forEach(function (b) {
        on(b, "click", function () {
          $$("#sleepChips button").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          self.setSleep(b.dataset.sleep);
        });
      });
    },

    updateABPosition: function () {
      var v = this.dom.videoPlayer;
      if (this.ab.a === null || this.ab.b === null || !isFinite(v.duration)) return;
      var el = this.dom.htAB;
      el.classList.add("show");
      el.style.left = (this.ab.a / v.duration * 100) + "%";
      el.style.width = ((this.ab.b - this.ab.a) / v.duration * 100) + "%";
    },

    checkAB: function () {
      var v = this.dom.videoPlayer;
      if (this.ab.a !== null && this.ab.b !== null && v.currentTime >= this.ab.b) {
        v.currentTime = this.ab.a;
      }
    },

    setSleep: function (mode) {
      if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
      this.sleepEnd = false;

      if (mode === "off") { toast("تایمر خواب خاموش", "info"); return; }
      if (mode === "end") {
        this.sleepEnd = true;
        toast("پخش بعد از این ویدیو متوقف می‌شه", "info");
        return;
      }
      var mins = parseInt(mode, 10);
      var self = this;
      this.sleepTimer = setTimeout(function () {
        self.dom.videoPlayer.pause();
        toast("تایمر خواب فعال شد", "info");
        self.sleepTimer = null;
      }, mins * 60000);
      toast("تایمر خواب: " + mins + " دقیقه", "success");
    },

    /* =============================================
       Subtitle
       ============================================= */
    bindSubtitlePane: function () {
      var self = this;
      on(this.dom.subEnableToggle, "change", function (e) {
        self.settings.subEnabled = e.target.checked;
        self.saveSettings();
        self.updateSubtitleCue(true);
      });
      on(this.dom.loadSubBtn, "click", function () { self.dom.subtitleInput.click(); });
      on(this.dom.subtitleInput, "change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) self.loadSubtitleFile(file);
        self.dom.subtitleInput.value = "";
      });
      on(this.dom.subFontSelect, "change", function (e) {
        self.settings.subFont = e.target.value;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subSizeSlider, "input", function (e) {
        self.settings.subSize = parseInt(e.target.value, 10);
        self.dom.subSizeVal.textContent = self.settings.subSize;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subWeightSlider, "input", function (e) {
        self.settings.subWeight = parseInt(e.target.value, 10);
        self.dom.subWeightVal.textContent = self.settings.subWeight;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subColorInput, "input", function (e) {
        self.settings.subColor = e.target.value;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subAutoContrastToggle, "change", function (e) {
        self.settings.subAutoContrast = e.target.checked;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subBgToggle, "change", function (e) {
        self.settings.subBg = e.target.checked;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subBgColorInput, "input", function (e) {
        self.settings.subBgColor = e.target.value;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subBgOpacitySlider, "input", function (e) {
        self.settings.subBgOpacity = parseInt(e.target.value, 10);
        self.dom.subBgOpacityVal.textContent = self.settings.subBgOpacity + "%";
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subRadiusSlider, "input", function (e) {
        self.settings.subRadius = parseInt(e.target.value, 10);
        self.dom.subRadiusVal.textContent = self.settings.subRadius;
        self.saveSettings();
        self.applySubtitleStyleVars();
        self.updateSubPreview();
      });
      on(this.dom.subPosSlider, "input", function (e) {
        self.settings.subPos = parseInt(e.target.value, 10);
        self.dom.subPosVal.textContent = self.settings.subPos;
        self.saveSettings();
        self.applySubtitleStyleVars();
      });
    },

    applySubtitleStyleVars: function () {
      var s = this.settings;
      var root = document.documentElement;
      root.style.setProperty("--sub-font", s.subFont);
      root.style.setProperty("--sub-size", s.subSize + "px");
      root.style.setProperty("--sub-weight", s.subWeight);
      root.style.setProperty("--sub-color", s.subColor);
      root.style.setProperty("--sub-bg-op", (s.subBgOpacity / 100).toFixed(2));
      root.style.setProperty("--sub-radius", s.subRadius + "px");
      if (this.dom.subtitleLayer) {
        this.dom.subtitleLayer.style.paddingBottom = s.subPos + "%";
      }
    },

    updateSubPreview: function () {
      var el = this.dom.subPreview;
      if (!el) return;
      var s = this.settings;
      el.textContent = "نمونه متن زیرنویس";
      el.style.fontFamily = s.subFont;
      el.style.fontSize = (s.subSize * 0.85) + "px";
      el.style.fontWeight = s.subWeight;
      el.style.color = s.subAutoContrast ? "#ffffff" : s.subColor;
      el.style.borderRadius = s.subRadius + "px";
      if (s.subBg) {
        el.style.background = "rgba(" + hexToRgb(s.subBgColor) + "," + (s.subBgOpacity / 100) + ")";
      } else {
        el.style.background = "transparent";
      }
      if (s.subAutoContrast) {
        el.style.mixBlendMode = "difference";
        el.style.textShadow = "none";
      } else {
        el.style.mixBlendMode = "normal";
        el.style.textShadow = "0 1px 3px rgba(0,0,0,0.9)";
      }
    },

    loadSubtitleFile: function (file) {
      var self = this;
      var item = this.playlist[this.currentIndex];
      if (!item) { toast("اول یه ویدیو پخش کن", "error"); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        var cues = parseSubtitle(e.target.result);
        if (!cues.length) { toast("فایل زیرنویس معتبر نیست", "error"); return; }
        self.currentCues = cues;
        self.subsByFile[item.id] = cues;
        self.currentCueIdx = -1;
        toast(cues.length + " خط زیرنویس لود شد", "success");
      };
      reader.readAsText(file, "UTF-8");
    },

    updateSubtitleCue: function (force) {
      if (!this.dom.subtitleLayer) return;
      var s = this.settings;
      var v = this.dom.videoPlayer;
      var layer = this.dom.subtitleLayer;

      if (!s.subEnabled || !this.currentCues.length) {
        if (layer.innerHTML) layer.innerHTML = "";
        return;
      }

      var t = v.currentTime;
      var activeIdx = -1;
      for (var i = 0; i < this.currentCues.length; i++) {
        var c = this.currentCues[i];
        if (t >= c.start && t <= c.end) { activeIdx = i; break; }
      }

      if (activeIdx === this.currentCueIdx && !force) return;
      this.currentCueIdx = activeIdx;

      if (activeIdx === -1) { layer.innerHTML = ""; return; }

      var cue = this.currentCues[activeIdx];
      layer.innerHTML = "";
      var lines = cue.text.split("\n");
      var rgb = hexToRgb(s.subBgColor);

      lines.forEach(function (line) {
        var div = document.createElement("div");
        div.className = "subtitle-cue";
        if (!s.subBg) div.classList.add("no-bg");
        if (s.subAutoContrast) div.classList.add("auto-contrast");
        if (s.subBg) div.style.background = "rgba(" + rgb + "," + (s.subBgOpacity / 100) + ")";
        div.style.borderRadius = s.subRadius + "px";
        div.textContent = line;
        layer.appendChild(div);
      });
    },

    toggleSubtitleQuick: function () {
      var s = this.settings;
      if (!this.currentCues.length) {
        this.dom.subtitleInput.click();
        return;
      }
      s.subEnabled = !s.subEnabled;
      if (this.dom.subEnableToggle) this.dom.subEnableToggle.checked = s.subEnabled;
      this.saveSettings();
      this.updateSubtitleCue(true);
      toast(s.subEnabled ? "زیرنویس روشن" : "زیرنویس خاموش", "info", 1400);
    },

    /* =============================================
       Tools
       ============================================= */
    bindToolsPane: function () {
      var self = this;
      on(this.dom.toolScreenshot, "click", function () { self.takeScreenshot(); });
      on(this.dom.toolBookmark, "click", function () { self.openBookmarkModal(); });
      on(this.dom.toolNote, "click", function () { self.openNoteModal(); });
      on(this.dom.toolPip, "click", function () { self.togglePip(); });
      on(this.dom.toolRotate, "click", function () { self.rotateVideo(); });
      on(this.dom.toolMirror, "click", function () { self.mirrorVideo(); });
      on(this.dom.toolFilters, "click", function () { self.closeHudSettings(); self.openModal("filtersModal"); });
      on(this.dom.toolShortcuts, "click", function () { self.closeHudSettings(); self.openModal("shortcutsModal"); });
    },

    takeScreenshot: function () {
      var v = this.dom.videoPlayer;
      if (!v.src || !v.videoWidth) { toast("ویدیویی پخش نمی‌شه", "error"); return; }
      try {
        var c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        var url = c.toDataURL("image/png");
        this._lastScreenshot = url;
        this.dom.screenshotPreview.src = url;
        this.openModal("screenshotModal");
      } catch (e) {
        toast("عکس‌برداری ناموفق", "error");
      }
    },

    openBookmarkModal: function () {
      var v = this.dom.videoPlayer;
      if (!v.src) { toast("اول یه ویدیو پخش کن", "info"); return; }
      this.dom.bookmarkTimeLabel.textContent = fmtTime(v.currentTime);
      this.dom.bookmarkNameInput.value = "";
      this._pendingBookmarkTime = v.currentTime;
      this.closeHudSettings();
      this.openModal("bookmarkModal");
    },

    saveBookmark: function () {
      var item = this.playlist[this.currentIndex];
      if (!item) return;
      var name = (this.dom.bookmarkNameInput.value || "").trim();
      if (!name) name = "بوک‌مارک " + ((this.bookmarks[item.id] || []).length + 1);
      if (!this.bookmarks[item.id]) this.bookmarks[item.id] = [];
      this.bookmarks[item.id].push({
        id: uid(),
        time: this._pendingBookmarkTime || 0,
        name: name
      });
      saveLS("bookmarks", this.bookmarks);
      this.closeModal("bookmarkModal");
      this.renderMarksOnTimeline();
      toast("بوک‌مارک ذخیره شد", "success");
    },

    openNoteModal: function () {
      var v = this.dom.videoPlayer;
      if (!v.src) { toast("اول یه ویدیو پخش کن", "info"); return; }
      this.dom.noteTimeLabel.textContent = fmtTime(v.currentTime);
      this.dom.noteTextInput.value = "";
      this._pendingNoteTime = v.currentTime;
      this.closeHudSettings();
      this.openModal("noteModal");
    },

    saveNote: function () {
      var item = this.playlist[this.currentIndex];
      if (!item) return;
      var text = (this.dom.noteTextInput.value || "").trim();
      if (!text) { toast("متن یادداشت خالیه", "error"); return; }
      if (!this.notes[item.id]) this.notes[item.id] = [];
      this.notes[item.id].push({
        id: uid(),
        time: this._pendingNoteTime || 0,
        text: text
      });
      saveLS("notes", this.notes);
      this.closeModal("noteModal");
      toast("یادداشت ذخیره شد", "success");
    },

    togglePip: function () {
      var v = this.dom.videoPlayer;
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(function () {});
      } else if (v.requestPictureInPicture) {
        v.requestPictureInPicture().catch(function () {
          toast("تصویر در تصویر پشتیبانی نمی‌شه", "error");
        });
      } else {
        toast("تصویر در تصویر پشتیبانی نمی‌شه", "error");
      }
    },

    rotateVideo: function () {
      var v = this.dom.videoPlayer;
      var cur = parseInt(v.dataset.rotate || "0", 10);
      var next = (cur + 90) % 360;
      v.dataset.rotate = next;
      this.applyVideoTransform();
    },

    mirrorVideo: function () {
      var v = this.dom.videoPlayer;
      v.dataset.mirror = v.dataset.mirror === "1" ? "0" : "1";
      this.applyVideoTransform();
    },

    applyVideoTransform: function () {
      var v = this.dom.videoPlayer;
      var rot = parseInt(v.dataset.rotate || "0", 10);
      var mirror = v.dataset.mirror === "1";
      var t = "";
      if (rot) t += "rotate(" + rot + "deg) ";
      if (mirror) t += "scaleX(-1)";
      v.style.transform = t.trim();
    },

    renderMarksOnTimeline: function () {
      var v = this.dom.videoPlayer;
      var wrap = this.dom.htMarks;
      if (!wrap) return;
      wrap.innerHTML = "";
      var item = this.playlist[this.currentIndex];
      if (!item || !isFinite(v.duration)) return;
      var arr = this.bookmarks[item.id] || [];
      arr.forEach(function (b) {
        var m = document.createElement("span");
        m.className = "ht-mark";
        m.style.left = (b.time / v.duration * 100) + "%";
        m.title = b.name;
        wrap.appendChild(m);
      });
    },

    /* =============================================
       Appearance
       ============================================= */
    bindAppearancePane: function () {
      var self = this;
      $$("#themeChips button").forEach(function (b) {
        on(b, "click", function () {
          self.setTheme(b.dataset.theme);
          $$("#themeChips button").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
        });
      });
      on(this.dom.glassOpSlider, "input", function (e) {
        self.settings.glassOpacity = parseInt(e.target.value, 10);
        if (self.dom.glassOpVal) self.dom.glassOpVal.textContent = self.settings.glassOpacity + "%";
        document.documentElement.style.setProperty("--glass-alpha", (self.settings.glassOpacity / 100).toFixed(2));
        self.saveSettings();
      });
      on(this.dom.blurSlider, "input", function (e) {
        self.settings.blurIntensity = parseInt(e.target.value, 10);
        if (self.dom.blurVal) self.dom.blurVal.textContent = self.settings.blurIntensity + "px";
        document.documentElement.style.setProperty("--blur", self.settings.blurIntensity + "px");
        self.saveSettings();
      });
      on(this.dom.reduceMotionToggle, "change", function (e) {
        self.settings.reduceMotion = e.target.checked;
        document.body.classList.toggle("reduce-motion", e.target.checked);
        self.saveSettings();
      });
      on(this.dom.exportSettingsBtn, "click", function () { self.exportSettings(); });
      on(this.dom.importSettingsBtn, "click", function () { self.dom.importInput.click(); });
      on(this.dom.importInput, "change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) self.importSettings(file);
        self.dom.importInput.value = "";
      });
      on(this.dom.resetSettingsBtn, "click", function () {
        if (!confirm("همه تنظیمات به حالت اولیه برگرده؟")) return;
        try { localStorage.removeItem("liquidplay.settings"); } catch (e) {}
        location.reload();
      });
    },

    exportSettings: function () {
      var data = {
        settings: this.settings,
        bookmarks: this.bookmarks,
        notes: this.notes,
        history: this.history
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "liquidplay-backup.json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("پشتیبان دانلود شد", "success");
    },

    importSettings: function (file) {
      var self = this;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          if (data.settings) self.settings = Object.assign(self.settings, data.settings);
          if (data.bookmarks) self.bookmarks = data.bookmarks;
          if (data.notes) self.notes = data.notes;
          if (data.history) self.history = data.history;
          saveLS("settings", self.settings);
          saveLS("bookmarks", self.bookmarks);
          saveLS("notes", self.notes);
          saveLS("history", self.history);
          self.applySettings();
          toast("تنظیمات بازیابی شد", "success");
        } catch (er) {
          toast("فایل نامعتبر", "error");
        }
      };
      reader.readAsText(file);
    },

    /* =============================================
       Gallery
       ============================================= */
    renderGallery: function () {
      var self = this;
      var grid = this.dom.galleryGrid;
      if (!grid) return;
      grid.innerHTML = "";

      var arr = this.gallery.slice();
      var sortMode = this.dom.gallerySort ? this.dom.gallerySort.value : "date";
      if (sortMode === "name") arr.sort(function (a, b) { return (a.name || "").localeCompare(b.name || "", "fa"); });
      if (sortMode === "size") arr.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });

      if (!arr.length) {
        if (this.dom.galleryEmpty) this.dom.galleryEmpty.classList.remove("hidden");
        return;
      } else {
        if (this.dom.galleryEmpty) this.dom.galleryEmpty.classList.add("hidden");
      }

      arr.forEach(function (img) {
        var el = document.createElement("div");
        el.className = "gallery-item";
        var imgEl = document.createElement("img");
        imgEl.src = img.url;
        imgEl.alt = img.name || "";
        var infoEl = document.createElement("div");
        infoEl.className = "gallery-item-info";
        infoEl.textContent = img.name || "";
        el.appendChild(imgEl);
        el.appendChild(infoEl);
        on(el, "click", function () { self.openPhotoByItem(img); });
        grid.appendChild(el);
      });
    },

    bindGallery: function () {
      var self = this;
      on(this.dom.gallerySort, "change", function () { self.renderGallery(); });
      on(this.dom.gallerySlideBtn, "click", function () {
        if (!self.gallery.length) { toast("عکسی نیست", "info"); return; }
        self.startSlideShow();
      });
    },

    startSlideShow: function () {
      var self = this;
      var i = 0;
      self.openPhotoByItem(self.gallery[0]);
      if (this._slideTimer) clearInterval(this._slideTimer);
      this._slideTimer = setInterval(function () {
        if (self.dom.photoViewer.classList.contains("hidden")) {
          clearInterval(self._slideTimer);
          self._slideTimer = null;
          return;
        }
        i = (i + 1) % self.gallery.length;
        self.openPhotoByItem(self.gallery[i]);
      }, 3500);
    },

    /* =============================================
       Photo Viewer
       ============================================= */
    openPhotoByItem: function (item) {
      if (!item || !item.url) {
        toast("عکس معتبر نیست", "error");
        return;
      }
      var idx = this.gallery.indexOf(item);
      this._photoIndex = idx >= 0 ? idx : 0;
      this._photoScale = 1;
      this._photoRotation = 0;
      this._photoTranslate = { x: 0, y: 0 };

      this.dom.pvImg.src = item.url;
      this.dom.pvName.textContent = item.name || "";
      this.dom.photoViewer.classList.remove("hidden");
      this.applyPhotoTransform();
    },

    bindPhotoViewer: function () {
      var self = this;

      on(this.dom.pvClose, "click", function () { self.closePhotoViewer(); });
      on(this.dom.pvBackdrop, "click", function () { self.closePhotoViewer(); });
      on(this.dom.pvPrev, "click", function (e) { e.stopPropagation(); self.navigatePhoto(-1); });
      on(this.dom.pvNext, "click", function (e) { e.stopPropagation(); self.navigatePhoto(1); });

      on(this.dom.pvZoomIn, "click", function () {
        self._photoScale = clamp(self._photoScale * 1.2, 0.2, 6);
        self.applyPhotoTransform();
      });
      on(this.dom.pvZoomOut, "click", function () {
        self._photoScale = clamp(self._photoScale / 1.2, 0.2, 6);
        self.applyPhotoTransform();
      });
      on(this.dom.pvRotate, "click", function () {
        self._photoRotation = (self._photoRotation + 90) % 360;
        self.applyPhotoTransform();
      });
      on(this.dom.pvReset, "click", function () {
        self._photoScale = 1;
        self._photoRotation = 0;
        self._photoTranslate = { x: 0, y: 0 };
        self.applyPhotoTransform();
      });
      on(this.dom.pvDownload, "click", function () {
        var cur = self.gallery[self._photoIndex];
        if (!cur) return;
        var a = document.createElement("a");
        a.href = cur.url;
        a.download = cur.name;
        a.click();
      });

      var panning = false, sx = 0, sy = 0;
      on(this.dom.pvStage, "pointerdown", function (e) {
        panning = true;
        sx = e.clientX - self._photoTranslate.x;
        sy = e.clientY - self._photoTranslate.y;
        try { self.dom.pvStage.setPointerCapture(e.pointerId); } catch (er) {}
      });
      on(this.dom.pvStage, "pointermove", function (e) {
        if (!panning) return;
        self._photoTranslate.x = e.clientX - sx;
        self._photoTranslate.y = e.clientY - sy;
        self.applyPhotoTransform();
      });
      on(this.dom.pvStage, "pointerup", function (e) {
        panning = false;
        try { self.dom.pvStage.releasePointerCapture(e.pointerId); } catch (er) {}
      });
      on(this.dom.pvStage, "pointercancel", function () { panning = false; });

      on(this.dom.pvStage, "wheel", function (e) {
        e.preventDefault();
        var d = e.deltaY < 0 ? 1.1 : 0.9;
        self._photoScale = clamp(self._photoScale * d, 0.2, 6);
        self.applyPhotoTransform();
      }, { passive: false });
    },

    applyPhotoTransform: function () {
      if (!this.dom.pvImg) return;
      this.dom.pvImg.style.transform =
        "translate(" + this._photoTranslate.x + "px," + this._photoTranslate.y + "px) " +
        "scale(" + this._photoScale + ") rotate(" + this._photoRotation + "deg)";
    },

    navigatePhoto: function (dir) {
      if (!this.gallery.length) return;
      this._photoIndex = (this._photoIndex + dir + this.gallery.length) % this.gallery.length;
      var item = this.gallery[this._photoIndex];
      this.dom.pvImg.src = item.url;
      this.dom.pvName.textContent = item.name;
      this._photoScale = 1;
      this._photoRotation = 0;
      this._photoTranslate = { x: 0, y: 0 };
      this.applyPhotoTransform();
    },

    closePhotoViewer: function () {
      this.dom.photoViewer.classList.add("hidden");
      if (this._slideTimer) {
        clearInterval(this._slideTimer);
        this._slideTimer = null;
      }
    },

    /* =============================================
       Modals
       ============================================= */
    openModal: function (id) {
      var m = $(id);
      if (!m) return;
      m.classList.remove("hidden");
    },
    closeModal: function (id) {
      var m = $(id);
      if (!m) return;
      m.classList.add("hidden");
    },

    bindModals: function () {
      var self = this;

      $$("[data-close-modal]").forEach(function (b) {
        on(b, "click", function () { self.closeModal(b.dataset.closeModal); });
      });
      $$(".modal").forEach(function (m) {
        on(m, "click", function (e) {
          if (e.target === m) self.closeModal(m.id);
        });
      });

      on(this.dom.bookmarkSaveBtn, "click", function () { self.saveBookmark(); });
      on(this.dom.noteSaveBtn, "click", function () { self.saveNote(); });

      on(this.dom.screenshotDownloadBtn, "click", function () {
        if (!self._lastScreenshot) return;
        var a = document.createElement("a");
        a.href = self._lastScreenshot;
        a.download = "screenshot-" + Date.now() + ".png";
        a.click();
      });
      on(this.dom.screenshotCopyBtn, "click", function () {
        if (!self._lastScreenshot) return;
        fetch(self._lastScreenshot)
          .then(function (r) { return r.blob(); })
          .then(function (blob) {
            return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          })
          .then(function () { toast("کپی شد", "success"); })
          .catch(function () { toast("کپی ناموفق", "error"); });
      });

      var bindFilter = function (el, valEl, suffix) {
        on(el, "input", function () {
          if (valEl) valEl.textContent = el.value + (suffix || "");
          self.applyFilters();
        });
      };
      bindFilter(this.dom.fBrightness, this.dom.fBriVal, "%");
      bindFilter(this.dom.fContrast, this.dom.fConVal, "%");
      bindFilter(this.dom.fSaturate, this.dom.fSatVal, "%");
      bindFilter(this.dom.fHue, this.dom.fHueVal, "");
      bindFilter(this.dom.fBlur, this.dom.fBlurVal, "px");

      on(this.dom.resetFiltersBtn, "click", function () {
        self.dom.fBrightness.value = 100;
        self.dom.fContrast.value = 100;
        self.dom.fSaturate.value = 100;
        self.dom.fHue.value = 0;
        self.dom.fBlur.value = 0;
        if (self.dom.fBriVal) self.dom.fBriVal.textContent = "100%";
        if (self.dom.fConVal) self.dom.fConVal.textContent = "100%";
        if (self.dom.fSatVal) self.dom.fSatVal.textContent = "100%";
        if (self.dom.fHueVal) self.dom.fHueVal.textContent = "0";
        if (self.dom.fBlurVal) self.dom.fBlurVal.textContent = "0px";
        self.applyFilters();
      });
    },

    applyFilters: function () {
      var v = this.dom.videoPlayer;
      var b = this.dom.fBrightness.value;
      var c = this.dom.fContrast.value;
      var s = this.dom.fSaturate.value;
      var h = this.dom.fHue.value;
      var bl = this.dom.fBlur.value;
      v.style.filter = "brightness(" + b + "%) contrast(" + c + "%) saturate(" + s + "%) hue-rotate(" + h + "deg) blur(" + bl + "px)";
    },

    /* =============================================
       Keyboard
       ============================================= */
    bindKeyboard: function () {
      var self = this;
      on(window, "keydown", function (e) {
        var tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
        if (!self.dom.photoViewer.classList.contains("hidden")) {
          if (e.key === "ArrowLeft") self.navigatePhoto(1);
          if (e.key === "ArrowRight") self.navigatePhoto(-1);
          if (e.key === "Escape") self.closePhotoViewer();
          return;
        }
        var v = self.dom.videoPlayer;
        switch (e.key) {
          case " ":
          case "k":
          case "K":
            e.preventDefault();
            self.togglePlay();
            break;
          case "ArrowLeft":
            e.preventDefault();
            v.currentTime = Math.max(0, v.currentTime - 5);
            self.showHud(true);
            break;
          case "ArrowRight":
            e.preventDefault();
            v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
            self.showHud(true);
            break;
          case "j": case "J":
            v.currentTime = Math.max(0, v.currentTime - 10);
            break;
          case "l": case "L":
            v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
            break;
          case "ArrowUp":
            e.preventDefault();
            v.volume = clamp(v.volume + 0.05, 0, 1);
            v.muted = false;
            break;
          case "ArrowDown":
            e.preventDefault();
            v.volume = clamp(v.volume - 0.05, 0, 1);
            break;
          case "m": case "M":
            v.muted = !v.muted;
            break;
          case "f": case "F":
            self.toggleFullscreen();
            break;
          case "p": case "P":
            self.togglePip();
            break;
          case "s": case "S":
            self.takeScreenshot();
            break;
          case "b": case "B":
            self.openBookmarkModal();
            break;
          case "n": case "N":
            self.openNoteModal();
            break;
          case "Escape":
            self.closeHudSettings();
            self.closeSidebar();
            $$(".modal").forEach(function (m) { self.closeModal(m.id); });
            break;
        }
      });
    },

    /* =============================================
       Gestures
       ============================================= */
    bindGestures: function () {
      var self = this;
      var stage = this.dom.videoStage;
      var v = this.dom.videoPlayer;
      if (!stage) return;

      var startX = 0, startY = 0, startTime = 0;
      var startVol = 1, startBri = 100;
      var mode = null;
      var moved = false;
      var longPressTimer = null;
      var longPressActive = false;
      var prevRate = 1;

      var ind = this.dom.gestureIndicator;
      var ic = this.dom.gestureIcon;
      var val = this.dom.gestureValue;
      var badge = this.dom.speedBadge;

      function showInd(icon, text) {
        if (!ind) return;
        if (ic) ic.textContent = icon;
        if (val) val.textContent = text;
        ind.classList.add("show");
      }
      function hideInd() { if (ind) ind.classList.remove("show"); }

      function showBadge() { if (badge) badge.classList.add("show"); }
      function hideBadge() { if (badge) badge.classList.remove("show"); }

      function isLeft(x) {
        var r = stage.getBoundingClientRect();
        return (x - r.left) < r.width / 2;
      }

      function cancelLongPress() {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }

      on(stage, "touchstart", function (e) {
        if (e.touches.length !== 1) return;
        var t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startTime = v.currentTime;
        startVol = v.volume;
        startBri = 100;
        mode = null;
        moved = false;
        longPressActive = false;

        // Long Press
        cancelLongPress();
        longPressTimer = setTimeout(function () {
          if (!moved && !mode) {
            longPressActive = true;
            prevRate = v.playbackRate;
            v.playbackRate = 2;
            showBadge();
            if (navigator.vibrate) navigator.vibrate(25);
            self.suppressNextClick = true;
          }
        }, 500);

        // Double Tap
        var now = Date.now();
        if (now - self._lastTapTime < 300 && Math.abs(t.clientX - self._lastTapX) < 60) {
          cancelLongPress();
          self.suppressNextClick = true;
          var r = stage.getBoundingClientRect();
          var mid = r.left + r.width / 2;
          if (t.clientX < mid) {
            v.currentTime = Math.max(0, v.currentTime - 10);
            showInd("◀◀", "10-");
          } else {
            v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
            showInd("▶▶", "10+");
          }
          setTimeout(hideInd, 500);
          self._lastTapTime = 0;
          return;
        }
        self._lastTapTime = now;
        self._lastTapX = t.clientX;
      }, { passive: true });

      on(stage, "touchmove", function (e) {
        if (e.touches.length !== 1) return;
        var t = e.touches[0];
        var dx = t.clientX - startX;
        var dy = t.clientY - startY;

        // اگر حرکت کرد
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          cancelLongPress();
          if (longPressActive) {
            v.playbackRate = prevRate;
            longPressActive = false;
            hideBadge();
          }
          moved = true;
        }

        if (!mode && moved) {
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 14) {
            mode = "seek";
          } else if (Math.abs(dy) > 14) {
            mode = isLeft(startX) ? "brightness" : "volume";
          }
        }

        if (mode === "seek") {
          if (e.cancelable) e.preventDefault();
          var r = stage.getBoundingClientRect();
          var pct = dx / r.width;
          var target = clamp(startTime + pct * (v.duration || 0), 0, v.duration || 0);
          self._seekTarget = target;
          showInd("◀▶", fmtTime(target));
          self.suppressNextClick = true;
        } else if (mode === "volume") {
          if (e.cancelable) e.preventDefault();
          var d1 = -dy / 200;
          v.volume = clamp(startVol + d1, 0, 1);
          v.muted = false;
          showInd("صدا", Math.round(v.volume * 100) + "%");
          self.suppressNextClick = true;
        } else if (mode === "brightness") {
          if (e.cancelable) e.preventDefault();
          var d2 = -dy / 200;
          var b = clamp(startBri + d2 * 100, 20, 200);
          var baseFilter = v.style.filter || "";
          var cleaned = baseFilter.replace(/brightness\([^)]*\)\s*/g, "");
          v.style.filter = "brightness(" + b + "%) " + cleaned;
          showInd("روشنایی", Math.round(b) + "%");
          self.suppressNextClick = true;
        }
      }, { passive: false });

      on(stage, "touchend", function () {
        cancelLongPress();
        if (longPressActive) {
          v.playbackRate = prevRate;
          longPressActive = false;
          hideBadge();
        }
        if (mode === "seek" && self._seekTarget != null) {
          v.currentTime = self._seekTarget;
          self._seekTarget = null;
        }
        mode = null;
        moved = false;
        setTimeout(hideInd, 300);
      });

      on(stage, "touchcancel", function () {
        cancelLongPress();
        if (longPressActive) {
          v.playbackRate = prevRate;
          longPressActive = false;
          hideBadge();
        }
        mode = null;
        moved = false;
        hideInd();
      });
    },

    /* =============================================
       Helpers
       ============================================= */
    revokeAll: function () {
      this.playlist.forEach(function (p) { try { URL.revokeObjectURL(p.url); } catch (e) {} });
      this.gallery.forEach(function (g) { try { URL.revokeObjectURL(g.url); } catch (e) {} });
    }
  };

  /* =====================================================
     راه‌اندازی
     ===================================================== */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { App.init(); });
  } else {
    App.init();
  }

  window.LiquidPlay = App;

})();
