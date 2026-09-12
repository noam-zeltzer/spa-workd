/* spa workd — a quiet to-do list.
   No framework, no build step. Runs as a static PWA and as a claude.ai
   Artifact from the same source; the only difference is where state is kept. */
(function () {
  "use strict";

  var STORE_KEY = "spa-workd/v1";
  var DOC_PATH = "state/main";

  /* ── time ───────────────────────────────────────────────────────────── */

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function keyOf(date) {
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + m + "-" + d;
  }

  function todayKey() { return keyOf(new Date()); }

  function keyPlus(days) {
    var d = startOfDay(new Date());
    d.setDate(d.getDate() + days);
    return keyOf(d);
  }

  /** Whole days from today to a 'YYYY-MM-DD' key. Negative means overdue. */
  function dayDiff(key) {
    var p = key.split("-");
    var then = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return Math.round((then - startOfDay(new Date())) / 86400000);
  }

  var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  function shortDate(key) {
    var p = key.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function dueLabel(key) {
    var diff = dayDiff(key);
    if (diff < -1) return Math.abs(diff) + " days late";
    if (diff === -1) return "Yesterday";
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff < 7) return shortDate(key);
    return shortDate(key);
  }

  /** Pull a date out of what someone typed, and hand back the tidied title. */
  function readDate(text) {
    var rules = [
      [/(^|\s)(today|tonight)(?=\s|$)/i, function () { return 0; }],
      [/(^|\s)(tomorrow|tmrw|tmw)(?=\s|$)/i, function () { return 1; }],
      [/(^|\s)next week(?=\s|$)/i, function () { return 7; }],
      [/(^|\s)(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)(?=\s|$)/i,
        function (m) {
          var word = m[3].toLowerCase();
          var index = -1;
          for (var i = 0; i < WEEKDAYS.length; i++) {
            if (WEEKDAYS[i].indexOf(word) === 0) { index = i; break; }
          }
          if (index < 0) return null;
          var ahead = (index - new Date().getDay() + 7) % 7 || 7;
          if (m[2] && ahead < 7) ahead += 7;
          return ahead;
        }]
    ];
    for (var i = 0; i < rules.length; i++) {
      var match = rules[i][0].exec(text);
      if (!match) continue;
      var offset = rules[i][1](match);
      if (offset === null) continue;
      var title = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
        .replace(/\s+/g, " ").trim();
      if (!title) continue;                     // the date word was the whole title
      return { title: title, due: keyPlus(offset) };
    }
    return { title: text.trim(), due: null };
  }

  /* ── state ──────────────────────────────────────────────────────────── */

  var PALETTE = ["#7DE8D2", "#A78BFA", "#F7C566", "#FF8098", "#7FB2FF", "#F2A3E8"];

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function seed() {
    var personal = { id: uid("l_"), name: "Personal", color: PALETTE[0] };
    var work = { id: uid("l_"), name: "Work", color: PALETTE[1] };
    var now = Date.now();
    return {
      lists: [personal, work],
      tasks: [
        { id: uid("t_"), title: "Tap the circle when something's done", done: false, listId: personal.id, due: todayKey(), createdAt: now, completedAt: null },
        { id: uid("t_"), title: "Type “tomorrow” or “friday” while adding — it sets the date", done: false, listId: personal.id, due: keyPlus(1), createdAt: now - 1, completedAt: null },
        { id: uid("t_"), title: "Swipe a task left to delete it", done: false, listId: work.id, due: null, createdAt: now - 2, completedAt: null }
      ],
      updatedAt: now
    };
  }

  function sane(raw) {
    if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.lists) || !raw.lists.length) return null;
    return {
      lists: raw.lists.filter(function (l) { return l && l.id && l.name; }).map(function (l) {
        return { id: String(l.id), name: String(l.name), color: l.color || PALETTE[0] };
      }),
      tasks: raw.tasks.filter(function (t) { return t && t.id && t.title; }).map(function (t) {
        return {
          id: String(t.id), title: String(t.title), done: !!t.done,
          listId: t.listId ? String(t.listId) : null,
          due: typeof t.due === "string" ? t.due : null,
          createdAt: Number(t.createdAt) || Date.now(),
          completedAt: Number(t.completedAt) || null
        };
      }),
      updatedAt: Number(raw.updatedAt) || 0
    };
  }

  function readLocal() {
    try { return sane(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { return null; }
  }

  function writeLocal(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* private mode, full disk */ }
  }

  var stored = readLocal();
  var state = stored || seed();
  if (!stored) writeLocal(state);       // first run: keep the starter list put
  var view = "today";
  var activeList = "all";
  var draftDue = null;
  var draftListId = null;
  var pending = Object.create(null);

  function byId(id) {
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) return state.tasks[i];
    return null;
  }

  function listById(id) {
    for (var i = 0; i < state.lists.length; i++) if (state.lists[i].id === id) return state.lists[i];
    return null;
  }

  function commit() {
    state.updatedAt = Date.now();
    writeLocal(state);
    pushRemote();
    renderBoard();
    renderCounts();
  }

  /* ── optional cross-device sync (Artifact `db`) ─────────────────────── */

  var remote = null;
  var pushTimer = null;

  function payload() {
    return { tasks: state.tasks, lists: state.lists, updatedAt: state.updatedAt };
  }

  function pushRemote() {
    if (!remote) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      try { remote.set(payload()).catch(function () {}); } catch (e) { /* offline */ }
    }, 350);
  }

  function adopt(raw) {
    var next = sane(raw);
    if (!next || next.updatedAt <= state.updatedAt) return false;
    state = next;
    writeLocal(state);
    renderLists();
    renderBoard();
    renderCounts();
    return true;
  }

  function connect() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    window.claude.use("db").then(function (db) {
      if (!db) return;
      remote = db.doc(DOC_PATH);
      remote.get().then(function (snap) {
        if (snap && snap.exists) {
          if (!adopt(snap.data())) pushRemote();
        } else {
          pushRemote();
        }
        remote.onSnapshot(function (s) {
          if (s && s.exists && !s.metadata.hasPendingWrites) adopt(s.data());
        }, function () { remote = null; });
      }).catch(function () { remote = null; });
    }).catch(function () {});
  }

  /* ── views ──────────────────────────────────────────────────────────── */

  var BUCKETS = ["Overdue", "Today", "Tomorrow", "This week", "Later", "Someday"];

  function bucketOf(task) {
    if (!task.due) return "Someday";
    var d = dayDiff(task.due);
    if (d < 0) return "Overdue";
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d <= 7) return "This week";
    return "Later";
  }

  var VIEW_BUCKETS = {
    today: ["Overdue", "Today"],
    upcoming: ["Tomorrow", "This week", "Later"],
    all: BUCKETS
  };

  function inActiveList(t) { return activeList === "all" || t.listId === activeList; }

  function visible() {
    return state.tasks.filter(function (t) {
      if (!inActiveList(t)) return false;
      if (view === "done") return t.done;
      if (t.done) return false;
      return VIEW_BUCKETS[view].indexOf(bucketOf(t)) > -1;
    });
  }

  function countFor(which) {
    return state.tasks.filter(function (t) {
      if (!inActiveList(t)) return false;
      if (which === "done") return t.done;
      if (t.done) return false;
      return VIEW_BUCKETS[which].indexOf(bucketOf(t)) > -1;
    }).length;
  }

  var EMPTY = {
    today: ["Nothing due today", "The quiet kind of day. Add something below when it turns up."],
    upcoming: ["Nothing scheduled ahead", "Give a task a date and it will wait for you here."],
    all: ["Your list is clear", "Start with the smallest thing you have been putting off."],
    done: ["Nothing finished yet", "Tick something off and it will settle down here."]
  };

  /* ── chrome ─────────────────────────────────────────────────────────── */

  var MARK =
    '<svg class="mark" viewBox="0 0 512 512" aria-hidden="true">' +
    '<defs><linearGradient id="sw-mark" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#7DE8D2"/><stop offset="1" stop-color="#A78BFA"/>' +
    "</linearGradient></defs>" +
    '<rect width="512" height="512" rx="116" fill="#0B0D14"/>' +
    '<circle cx="256" cy="256" r="150" fill="none" stroke="url(#sw-mark)" stroke-opacity=".22" stroke-width="22"/>' +
    '<path d="M176 262l52 52 108-128" fill="none" stroke="url(#sw-mark)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";

  var SEGMENTS = [["today", "Today"], ["upcoming", "Upcoming"], ["all", "All"], ["done", "Done"]];

  document.getElementById("app").innerHTML =
    '<div class="aurora"></div>' +
    '<div class="app">' +
      '<header class="masthead">' + MARK +
        "<div><h1 class=\"wordmark\">spa workd</h1>" +
        '<p class="standfirst" id="standfirst"></p></div>' +
      "</header>" +
      '<div class="deck">' +
        '<div class="segs" id="segs" role="tablist" aria-label="Which tasks to show">' +
          '<span class="seg-pill" id="seg-pill"></span>' +
          SEGMENTS.map(function (s) {
            return '<button class="seg" role="tab" type="button" data-view="' + s[0] + '" aria-selected="false">' +
              s[1] + '<span class="tally"></span></button>';
          }).join("") +
        "</div>" +
        '<div class="lists" id="lists"></div>' +
      "</div>" +
      '<main class="board" id="board"></main>' +
    "</div>" +
    '<form class="composer" id="composer" autocomplete="off">' +
      '<div class="extras"><div><div class="chips" id="chips"></div></div></div>' +
      '<div class="compose-row">' +
        '<label class="sr-only" for="title-input">New task</label>' +
        '<input id="title-input" placeholder="What needs doing?" enterkeyhint="done">' +
        '<button class="send" type="submit" disabled aria-label="Add task">' +
          '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>' +
        "</button>" +
      "</div>" +
    "</form>" +
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>';

  var $segs = document.getElementById("segs");
  var $pill = document.getElementById("seg-pill");
  var $lists = document.getElementById("lists");
  var $board = document.getElementById("board");
  var $composer = document.getElementById("composer");
  var $input = document.getElementById("title-input");
  var $send = $composer.querySelector(".send");
  var $chips = document.getElementById("chips");
  var $toast = document.getElementById("toast");
  var $standfirst = document.getElementById("standfirst");

  /* ── rendering ──────────────────────────────────────────────────────── */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderCounts() {
    var segs = $segs.querySelectorAll(".seg");
    for (var i = 0; i < segs.length; i++) {
      var name = segs[i].dataset.view;
      var n = countFor(name);
      segs[i].querySelector(".tally").textContent = n ? String(n) : "";
      segs[i].setAttribute("aria-selected", String(name === view));
    }
    var left = countFor("today");
    var date = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    $standfirst.innerHTML = "";
    $standfirst.append(date + "  ·  ");
    $standfirst.append(el("b", null, left ? String(left) : "nothing"), " left today");
    movePill();
  }

  function movePill() {
    var active = $segs.querySelector('.seg[aria-selected="true"]');
    if (!active) return;
    $pill.style.width = active.offsetWidth + "px";
    $pill.style.transform = "translateX(" + active.offsetLeft + "px)";
  }

  function renderLists() {
    $lists.innerHTML = "";
    var all = el("button", "pill", "All lists");
    all.type = "button";
    all.setAttribute("aria-pressed", String(activeList === "all"));
    all.onclick = function () { activeList = "all"; renderLists(); renderBoard(); renderCounts(); };
    $lists.append(all);

    state.lists.forEach(function (list) {
      var pill = el("button", "pill");
      pill.type = "button";
      pill.setAttribute("aria-pressed", String(activeList === list.id));
      var dot = el("span", "dot");
      dot.style.background = list.color;
      pill.append(dot, document.createTextNode(list.name));
      pill.onclick = function () {
        activeList = activeList === list.id ? "all" : list.id;
        draftListId = activeList === "all" ? null : list.id;
        renderLists(); renderBoard(); renderCounts(); renderChips();
      };
      holdToEdit(pill, list);
      $lists.append(pill);
    });

    var add = el("button", "pill add-list", "+");
    add.type = "button";
    add.setAttribute("aria-label", "New list");
    add.onclick = function () { newListField(add); };
    $lists.append(add);
  }

  function newListField(anchor) {
    var field = el("input", "pill-input");
    field.placeholder = "List name";
    field.maxLength = 24;
    anchor.replaceWith(field);
    field.focus();
    var settled = false;
    var settle = function (save) {
      if (settled) return;              // Enter then blur must not add it twice
      settled = true;
      var name = field.value.trim();
      if (save && name) {
        state.lists.push({ id: uid("l_"), name: name, color: PALETTE[state.lists.length % PALETTE.length] });
        commit();
      }
      renderLists();
      renderChips();
    };
    field.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); settle(true); }
      if (e.key === "Escape") settle(false);
    };
    field.onblur = function () { settle(true); };
  }

  /** Press and hold a list pill to rename or remove it. */
  function holdToEdit(pill, list) {
    var timer = null;
    var start = function () {
      timer = setTimeout(function () { editList(pill, list); }, 550);
    };
    var stop = function () { clearTimeout(timer); };
    pill.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
      pill.addEventListener(ev, stop);
    });
    pill.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function editList(pill, list) {
    var wrap = el("div", "editing");
    var field = el("input", "pill-input");
    field.value = list.name;
    field.maxLength = 24;
    var kill = el("button", "kill", "Delete");
    kill.type = "button";
    var done = false;
    var settle = function (save) {
      if (done) return;
      done = true;
      var name = field.value.trim();
      if (save && name && name !== list.name) { list.name = name; commit(); }
      renderLists(); renderChips();
    };
    kill.onmousedown = kill.ontouchstart = function (e) { e.preventDefault(); };
    kill.onclick = function () {
      done = true;
      state.tasks = state.tasks.filter(function (t) { return t.listId !== list.id; });
      state.lists = state.lists.filter(function (l) { return l.id !== list.id; });
      if (!state.lists.length) state.lists.push({ id: uid("l_"), name: "Personal", color: PALETTE[0] });
      if (activeList === list.id) activeList = "all";
      draftListId = null;
      commit(); renderLists(); renderChips();
      say("List deleted");
    };
    field.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); settle(true); }
      if (e.key === "Escape") settle(false);
    };
    field.onblur = function () { setTimeout(function () { settle(true); }, 80); };
    wrap.append(field, kill);
    pill.replaceWith(wrap);
    field.focus();
    field.select();
  }

  function taskRow(task) {
    var row = el("div", "row" + (task.done ? " is-done" : ""));
    row.dataset.id = task.id;

    var plate = el("div", "plate", "Delete");
    var card = el("div", "card");

    var check = el("button", "check");
    check.type = "button";
    check.setAttribute("aria-pressed", String(task.done));
    check.setAttribute("aria-label", (task.done ? "Mark unfinished: " : "Mark done: ") + task.title);
    check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="tick" d="M6 12.4l3.9 3.9L18 7.6"/></svg>';
    check.onclick = function () { toggle(task.id); };

    var body = el("div", "body");
    body.append(el("span", "title", task.title));

    var meta = el("div", "meta");
    if (task.due && !task.done) {
      var diff = dayDiff(task.due);
      var due = el("span", "due" + (diff < 0 ? " late" : diff === 0 ? " soon" : ""), dueLabel(task.due));
      meta.append(due);
    }
    var list = listById(task.listId);
    if (list) {
      var tag = el("span", "tag");
      var dot = el("span", "dot");
      dot.style.background = list.color;
      tag.append(dot, document.createTextNode(list.name));
      meta.append(tag);
    }
    if (meta.childNodes.length) body.append(meta);

    card.append(check, body);
    row.append(plate, card);
    swipeToDelete(row, card, task.id);
    return row;
  }

  function renderBoard() {
    var items = visible();
    $board.innerHTML = "";

    if (!items.length) {
      var copy = EMPTY[view];
      var empty = el("div", "empty");
      var halo = el("div", "halo");
      halo.append(el("span"));
      empty.append(halo, el("h2", null, copy[0]), el("p", null, copy[1]));
      $board.append(empty);
      return;
    }

    if (view === "done") {
      items.sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
      $board.append(el("div", "group-label", "Done"));
      var done = el("div", "tasks");
      items.forEach(function (t) { done.append(taskRow(t)); });
      $board.append(done);
      return;
    }

    var groups = {};
    items.forEach(function (t) {
      var b = bucketOf(t);
      (groups[b] || (groups[b] = [])).push(t);
    });

    BUCKETS.forEach(function (name) {
      var group = groups[name];
      if (!group) return;
      group.sort(function (a, b) {
        if (a.due !== b.due) return (a.due || "9999").localeCompare(b.due || "9999");
        return b.createdAt - a.createdAt;
      });
      $board.append(el("div", "group-label", name));
      var wrap = el("div", "tasks");
      group.forEach(function (t) { wrap.append(taskRow(t)); });
      $board.append(wrap);
    });
  }

  /* ── acting on tasks ────────────────────────────────────────────────── */

  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ }
  }

  function toggle(id) {
    var task = byId(id);
    if (!task || pending[id]) return;
    if (task.done) {
      task.done = false;
      task.completedAt = null;
      commit();
      return;
    }
    var row = $board.querySelector('.row[data-id="' + id + '"]');
    pending[id] = true;
    buzz(9);
    if (row) {
      row.classList.add("is-done");
      var check = row.querySelector(".check");
      if (check) check.setAttribute("aria-pressed", "true");
    }
    setTimeout(function () {
      delete pending[id];
      var t = byId(id);
      if (!t) return;
      t.done = true;
      t.completedAt = Date.now();
      commit();
    }, 440);
  }

  var undoTimer = null;

  function say(message, actionLabel, action) {
    clearTimeout(undoTimer);
    $toast.innerHTML = "";
    $toast.append(el("span", null, message));
    if (actionLabel) {
      var btn = el("button", null, actionLabel);
      btn.type = "button";
      btn.onclick = function () { hideToast(); action(); };
      $toast.append(btn);
    }
    $toast.classList.add("show");
    undoTimer = setTimeout(hideToast, 5200);
  }

  function hideToast() {
    clearTimeout(undoTimer);
    $toast.classList.remove("show");
  }

  function removeTask(id) {
    var index = -1;
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) { index = i; break; }
    if (index < 0) return;
    var gone = state.tasks[index];
    var at = index;
    state.tasks.splice(index, 1);
    buzz(12);
    var row = $board.querySelector('.row[data-id="' + id + '"]');
    if (row) {
      row.classList.add("leaving");
      setTimeout(commit, 220);
    } else {
      commit();
    }
    say("Task deleted", "Undo", function () {
      state.tasks.splice(Math.min(at, state.tasks.length), 0, gone);
      commit();
    });
  }

  /** Horizontal drag on a card reveals the delete plate; far enough removes it. */
  function swipeToDelete(row, card, id) {
    var startX = 0, startY = 0, dx = 0, axis = null, active = false;

    card.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".check")) return;
      active = true; axis = null; dx = 0;
      startX = e.clientX; startY = e.clientY;
    });

    card.addEventListener("pointermove", function (e) {
      if (!active) return;
      var mx = e.clientX - startX;
      var my = e.clientY - startY;
      if (!axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
        if (axis === "x") {
          row.classList.add("dragging");
          try { card.setPointerCapture(e.pointerId); } catch (err) { /* already captured */ }
        }
      }
      if (axis !== "x") return;
      dx = Math.min(0, mx);
      card.style.transform = "translateX(" + dx + "px)";
    });

    var release = function () {
      if (!active) return;
      active = false;
      row.classList.remove("dragging");
      if (axis === "x" && dx < -96) {
        removeTask(id);                 // keep the drag offset; the row slides the rest of the way
      } else {
        card.style.transform = "";
      }
      axis = null; dx = 0;
    };

    card.addEventListener("pointerup", release);
    card.addEventListener("pointercancel", release);
    card.addEventListener("pointerleave", function () { if (axis === "x") release(); });
  }

  /* ── composer ───────────────────────────────────────────────────────── */

  function targetList() {
    if (draftListId && listById(draftListId)) return listById(draftListId);
    if (activeList !== "all" && listById(activeList)) return listById(activeList);
    return state.lists[0];
  }

  function renderChips() {
    $chips.innerHTML = "";
    var options = [["Someday", null], ["Today", keyPlus(0)], ["Tomorrow", keyPlus(1)], ["Next week", keyPlus(7)]];
    options.forEach(function (opt) {
      var chip = el("button", "chip", opt[0]);
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(draftDue === opt[1]));
      chip.onclick = function () { draftDue = opt[1]; renderChips(); $input.focus(); };
      $chips.append(chip);
    });

    var picker = el("label", "chip");
    var isCustom = draftDue && [keyPlus(0), keyPlus(1), keyPlus(7)].indexOf(draftDue) < 0;
    picker.setAttribute("aria-pressed", String(!!isCustom));
    picker.append(document.createTextNode(isCustom ? shortDate(draftDue) : "Pick a date"));
    var field = el("input", "date-field");
    field.type = "date";
    field.id = "due-picker";
    if (draftDue) field.value = draftDue;
    field.onchange = function () { draftDue = field.value || null; renderChips(); };
    picker.append(field);
    $chips.append(picker);

    var list = targetList();
    if (list && state.lists.length > 1) {
      var swap = el("button", "chip");
      swap.type = "button";
      var dot = el("span", "dot");
      dot.style.cssText = "width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px;background:" + list.color;
      swap.append(dot, document.createTextNode(list.name));
      swap.onclick = function () {
        var i = state.lists.indexOf(list);
        draftListId = state.lists[(i + 1) % state.lists.length].id;
        renderChips();
        $input.focus();
      };
      $chips.append(swap);
    }
  }

  function openComposer(open) {
    $composer.classList.toggle("open", open);
  }

  $input.addEventListener("focus", function () { openComposer(true); });
  $input.addEventListener("input", function () {
    $send.disabled = !$input.value.trim();
    openComposer(true);
  });
  $input.addEventListener("blur", function () {
    setTimeout(function () {
      if (!$composer.contains(document.activeElement) && !$input.value.trim()) openComposer(false);
    }, 150);
  });

  $composer.addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = $input.value.trim();
    if (!raw) return;
    var parsed = readDate(raw);
    var list = targetList();
    var task = {
      id: uid("t_"),
      title: parsed.title,
      done: false,
      listId: list ? list.id : null,
      due: draftDue || parsed.due,
      createdAt: Date.now(),
      completedAt: null
    };
    state.tasks.unshift(task);
    $input.value = "";
    $send.disabled = true;
    draftDue = null;

    // Never let a new task land somewhere the current view hides it.
    if (view === "done" || VIEW_BUCKETS[view].indexOf(bucketOf(task)) < 0) view = "all";
    if (activeList !== "all" && task.listId !== activeList) activeList = "all";

    buzz(6);
    commit();
    renderLists();
    renderChips();
    var fresh = $board.querySelector('.row[data-id="' + task.id + '"]');
    if (fresh) fresh.classList.add("enter");
    $input.focus();
  });

  $segs.addEventListener("click", function (e) {
    var seg = e.target.closest(".seg");
    if (!seg) return;
    view = seg.dataset.view;
    renderBoard();
    renderCounts();
  });

  /* ── boot ───────────────────────────────────────────────────────────── */

  renderLists();
  renderBoard();
  renderChips();
  renderCounts();
  requestAnimationFrame(function () {
    movePill();
    $pill.classList.add("ready");
  });

  window.addEventListener("resize", movePill);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(movePill);

  /* Roll the day over if the app is left open past midnight. */
  var day = todayKey();
  setInterval(function () {
    if (todayKey() === day) return;
    day = todayKey();
    renderBoard();
    renderCounts();
  }, 60000);

  connect();

  if ("serviceWorker" in navigator && document.querySelector('link[rel="manifest"]')) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* not served over https */ });
    });
  }
})();
