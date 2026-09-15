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

  /* List colours, anchored on the logo's teal and wood and kept muted enough
     to sit together on paper. */
  var PALETTE = ["#4B918F", "#A78562", "#5B7C99", "#7E8F5A", "#8C6A9B", "#C08A4A"];

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
          notes: typeof t.notes === "string" ? t.notes : "",
          repeat: t.repeat === "daily" ? "daily" : null,
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

  /* A daily task is one task that keeps coming back, not a pile of copies.
     Its due date is simply moved to today: finished yesterday, it returns
     fresh; missed yesterday, it returns today rather than sitting in Overdue
     for ever, which is what a habit should do. Today's instance — done or
     not — is left alone, so ticking one off still files it under Done until
     the day turns. */
  function rollDailies() {
    var today = todayKey();
    var moved = false;
    state.tasks.forEach(function (t) {
      if (t.repeat !== "daily") return;
      if (!t.due) { t.due = today; moved = true; return; }
      if (t.due >= today) return;
      t.due = today;
      t.done = false;
      t.completedAt = null;
      moved = true;
    });
    return moved;
  }

  function commit() {
    state.updatedAt = Date.now();
    writeLocal(state);
    pushRemote();
    syncReminders();
    renderBoard();
    renderCounts();
  }

  /* ── reminders (Android build only) ─────────────────────────────────── */

  /* In the packaged app, Capacitor exposes the native plugins on
     window.Capacitor.Plugins. On the web there is no such object and every
     call below is skipped, so the same file serves both. */
  function notifications() {
    var cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.LocalNotifications) || null;
  }

  /* Android notification ids are 32-bit ints; task ids are strings. */
  function notifId(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h) % 2000000000 || 1;
  }

  function remindAt(key) { return new Date(key + "T09:00:00"); }

  var reminderTimer = null;

  /* Cancel everything pending and lay the schedule down again. Rescheduling
     wholesale keeps the notifications honest however a task changed — edited,
     finished, deleted, undeleted — without tracking each case. */
  function syncReminders() {
    var ln = notifications();
    if (!ln) return;
    clearTimeout(reminderTimer);
    reminderTimer = setTimeout(function () {
      ln.getPending().then(function (res) {
        var pending = (res && res.notifications) || [];
        if (!pending.length) return null;
        return ln.cancel({ notifications: pending.map(function (n) { return { id: n.id }; }) });
      }).then(function () {
        var now = Date.now();
        var due = state.tasks.filter(function (t) {
          return !t.done && t.due && remindAt(t.due).getTime() > now;
        }).slice(0, 60);          // Android caps how many alarms an app may hold
        if (!due.length) return null;
        return ln.schedule({
          notifications: due.map(function (t) {
            return {
              id: notifId(t.id),
              title: t.title,
              body: "Due today · spa workd",
              smallIcon: "ic_stat_sofa",
              schedule: { at: remindAt(t.due), allowWhileIdle: true }
            };
          })
        });
      }).catch(function () { /* permission refused, or no alarm slots */ });
    }, 400);
  }

  function askForNotifications() {
    var ln = notifications();
    if (!ln) return;
    ln.checkPermissions().then(function (status) {
      if (status && status.display === "granted") return syncReminders();
      if (status && status.display && status.display.indexOf("prompt") === 0) {
        return ln.requestPermissions().then(syncReminders);
      }
    }).catch(function () { /* older Android, or the user said no */ });
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
    today: ["Nothing due today", "Put your feet up. Add something below when it turns up."],
    upcoming: ["Nothing scheduled ahead", "Give a task a date and it will wait for you here."],
    all: ["Your list is clear", "Start with the smallest thing you have been putting off."],
    done: ["Nothing finished yet", "Tick something off and it will settle down here."]
  };

  /* ── chrome ─────────────────────────────────────────────────────────── */

  /* The logo itself, cut from the supplied artwork: icons/sofa.png is the
     sofa and icons/wordmark.png the lettering, both with the paper keyed out
     so they sit on any ground. The app icons are rendered from the same sofa. */
  function sofa(cls) {
    return '<img class="' + cls + '" src="icons/sofa.png" alt="" aria-hidden="true">';
  }

  var MARK = sofa("mark");

  var SEGMENTS = [["today", "Today"], ["upcoming", "Upcoming"], ["all", "All"], ["done", "Done"]];

  document.getElementById("app").innerHTML =
    '<div class="wash"></div>' +
    '<div class="app">' +
      '<header class="masthead">' + MARK +
        '<div><h1 class="wordmark"><img src="icons/wordmark.png" alt="spa workd"></h1>' +
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
        '<input id="title-input" dir="auto" placeholder="What needs doing?" enterkeyhint="done">' +
        '<button class="send" type="submit" disabled aria-label="Add task">' +
          '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>' +
        "</button>" +
      "</div>" +
    "</form>" +
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>' +
    '<div class="sheet-wrap" id="sheet-wrap" hidden>' +
      '<div class="scrim" id="scrim"></div>' +
      '<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Edit task">' +
        '<div class="grip"></div>' +
        '<label class="sr-only" for="sheet-title">Task</label>' +
        '<input class="sheet-title" id="sheet-title" dir="auto" enterkeyhint="done">' +
        '<div class="field"><p class="field-label">Repeats</p>' +
          '<div class="chips" id="sheet-repeat"></div></div>' +
        '<div class="field" id="when-field"><p class="field-label">When</p>' +
          '<div class="chips" id="sheet-dates"></div></div>' +
        '<div class="field"><p class="field-label">List</p>' +
          '<div class="chips" id="sheet-lists"></div></div>' +
        '<div class="field">' +
          '<div class="field-head">' +
            '<p class="field-label">Notes</p>' +
            '<button type="button" class="bullet-btn" id="bullet-btn" aria-label="Bullet this line">' +
              '<span class="pip"></span>Bullet</button>' +
          "</div>" +
          '<label class="sr-only" for="sheet-notes">Notes</label>' +
          '<textarea class="notes" id="sheet-notes" dir="auto" rows="3" ' +
            'placeholder="Anything worth remembering."></textarea>' +
        "</div>" +
        '<div class="sheet-foot">' +
          '<button type="button" class="ghost" id="sheet-delete">Delete task</button>' +
          '<button type="button" class="filled" id="sheet-done">Done</button>' +
        "</div>" +
      "</div>" +
    "</div>";

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
  var $sheetWrap = document.getElementById("sheet-wrap");
  var $sheet = document.getElementById("sheet");
  var $sheetTitle = document.getElementById("sheet-title");
  var $sheetDates = document.getElementById("sheet-dates");
  var $sheetRepeat = document.getElementById("sheet-repeat");
  var $whenField = document.getElementById("when-field");
  var $sheetLists = document.getElementById("sheet-lists");
  var $notes = document.getElementById("sheet-notes");

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
    var title = el("span", "title", task.title);
    title.setAttribute("dir", "auto");       // Hebrew reads right to left, English left to right
    body.append(title);

    var meta = el("div", "meta");
    // A daily task says "Daily" instead of "Today" — the two together are noise.
    if (task.due && !task.done && task.repeat !== "daily") {
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
    /* A task with notes wears a small bulleted-list mark, and the number of
       lines when there is more than one. Enough to tell you something is in
       there; not so much that the list stops being a list. */
    if (task.repeat === "daily") {
      var daily = el("span", "daily");
      daily.innerHTML = DAILY_GLYPH;
      daily.append(document.createTextNode("Daily"));
      meta.append(daily);
    }
    var lines = noteLines(task.notes);
    if (lines) {
      var mark = el("span", "noted");
      mark.innerHTML = NOTES_GLYPH;
      if (lines > 1) mark.append(document.createTextNode(String(lines)));
      mark.setAttribute("title", lines + (lines === 1 ? " note" : " notes"));
      meta.append(mark);
    }
    if (meta.childNodes.length) body.append(meta);

    card.append(check, body);
    row.append(plate, card);
    rowGestures(row, card, task.id);
    return row;
  }

  function renderBoard() {
    var items = visible();
    $board.innerHTML = "";

    if (!items.length) {
      var copy = EMPTY[view];
      var empty = el("div", "empty");
      var halo = el("div", "halo");
      halo.innerHTML = sofa("rest");
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

  /** Horizontal drag reveals the delete plate and far enough removes the task;
      a press that never travels is a tap, and opens the task. */
  function rowGestures(row, card, id) {
    var startX = 0, startY = 0, dx = 0, axis = null, active = false, travelled = false;

    /* Opening happens on the click, not on pointerup. Opening on pointerup put
       the scrim under the finger before the browser dispatched its follow-up
       click, so a quick tap opened the sheet and then immediately closed it
       again — while a long press, where the browser suppresses that click,
       appeared to work. Handling the click itself means the target is settled
       before the sheet exists, and nothing else receives it. */
    card.addEventListener("click", function (e) {
      if (e.target.closest(".check")) return;
      if (travelled) { travelled = false; return; }    // that was a swipe
      openSheet(id);
    });

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
      travelled = axis !== null;
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
      notes: "",
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

  /* ── the task sheet ─────────────────────────────────────────────────── */

  var NOTES_GLYPH =
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<circle cx="3" cy="4" r="1.15"/><circle cx="3" cy="8" r="1.15"/><circle cx="3" cy="12" r="1.15"/>' +
    '<path d="M6.6 4h7M6.6 8h7M6.6 12h4.4"/></svg>';

  var DAILY_GLYPH =
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M13.7 8a5.7 5.7 0 1 1-1.7-4"/><path d="M13.8 1.9v3.2h-3.2"/></svg>';

  /** How many lines of actual writing a note holds. Blank lines do not count. */
  function noteLines(notes) {
    if (!notes) return 0;
    return notes.split("\n").filter(function (line) {
      return line.replace(/^[•\s]+/, "").trim().length > 0;
    }).length;
  }

  var sheetId = null;
  var saveTimer = null;

  function sheetTask() { return sheetId ? byId(sheetId) : null; }

  /** Writes are debounced: typing a note should not re-render the board on
      every keystroke, but nothing may be lost when the sheet closes. */
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    var task = sheetTask();
    if (!task) return;
    var title = $sheetTitle.value.trim();
    if (title) task.title = title;        // an empty title would lose the task
    task.notes = $notes.value;
    commit();
  }

  function growNotes() {
    $notes.style.height = "auto";
    $notes.style.height = Math.min($notes.scrollHeight, 340) + "px";
  }

  function chip(label, on, onPick) {
    var b = el("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.onclick = onPick;
    return b;
  }

  function renderSheetDates() {
    var task = sheetTask();
    if (!task) return;
    $sheetDates.innerHTML = "";
    var options = [
      ["No date", null], ["Today", keyPlus(0)], ["Tomorrow", keyPlus(1)], ["Next week", keyPlus(7)]
    ];
    options.forEach(function (opt) {
      $sheetDates.append(chip(opt[0], task.due === opt[1], function () {
        task.due = opt[1];
        commit();
        renderSheetDates();
      }));
    });

    // Anything that is not one of the quick picks gets the date itself as its label.
    var quick = options.map(function (o) { return o[1]; });
    var custom = task.due && quick.indexOf(task.due) < 0;
    var picker = el("label", "chip");
    picker.setAttribute("aria-pressed", String(!!custom));
    picker.append(document.createTextNode(custom ? shortDate(task.due) : "Pick a date"));
    var field = el("input", "date-field");
    field.type = "date";
    field.id = "sheet-date-picker";
    if (task.due) field.value = task.due;
    field.onchange = function () {
      task.due = field.value || null;
      commit();
      renderSheetDates();
    };
    picker.append(field);
    $sheetDates.append(picker);
  }

  function renderSheetRepeat() {
    var task = sheetTask();
    if (!task) return;
    var daily = task.repeat === "daily";
    $sheetRepeat.innerHTML = "";

    $sheetRepeat.append(chip("Once", !daily, function () {
      task.repeat = null;
      commit();
      renderSheetRepeat();
      renderSheetDates();
    }));

    var every = chip("", daily, function () {
      task.repeat = "daily";
      task.due = todayKey();        // a daily task starts today and moves itself on
      commit();
      renderSheetRepeat();
      renderSheetDates();
    });
    var glyph = el("span", "chip-glyph");
    glyph.innerHTML = DAILY_GLYPH;
    every.append(glyph, document.createTextNode("Every day"));
    $sheetRepeat.append(every);

    // A daily task's date is "every day", so offering a date as well would lie.
    $whenField.hidden = daily;
  }

  function renderSheetLists() {
    var task = sheetTask();
    if (!task) return;
    $sheetLists.innerHTML = "";
    state.lists.forEach(function (list) {
      var on = task.listId === list.id;
      var b = chip("", on, function () {
        task.listId = list.id;
        commit();
        renderSheetLists();
      });
      var dot = el("span", "swatch");
      dot.style.background = list.color;
      b.append(dot, document.createTextNode(list.name));
      $sheetLists.append(b);
    });
  }

  function openSheet(id) {
    var task = byId(id);
    if (!task) return;
    sheetId = id;
    $sheetTitle.value = task.title;
    $notes.value = task.notes || "";
    renderSheetRepeat();
    renderSheetDates();
    renderSheetLists();
    $sheetWrap.hidden = false;
    requestAnimationFrame(function () {
      $sheetWrap.classList.add("open");
      growNotes();
    });
  }

  function closeSheet() {
    if (!sheetId) return;
    saveNow();
    sheetId = null;
    $sheetWrap.classList.remove("open");
    setTimeout(function () { $sheetWrap.hidden = true; }, 240);
  }

  /* ── bullets ─────────────────────────────────────────────────────────
     A plain textarea rather than a contenteditable: on Android, contenteditable
     fights the keyboard and mangles right-to-left text. Bullets are therefore
     just a "• " prefix on a line, which also means notes stay readable text. */

  function lineAround(value, pos) {
    var start = value.lastIndexOf("\n", pos - 1) + 1;
    var end = value.indexOf("\n", pos);
    return [start, end < 0 ? value.length : end];
  }

  function toggleBullet() {
    var v = $notes.value;
    var pos = $notes.selectionStart;
    var at = lineAround(v, pos);
    var line = v.slice(at[0], at[1]);
    var next, shift;
    if (/^•\s?/.test(line)) {
      next = line.replace(/^•\s?/, "");
      shift = next.length - line.length;
    } else {
      next = "• " + line;
      shift = 2;
    }
    $notes.value = v.slice(0, at[0]) + next + v.slice(at[1]);
    var caret = Math.max(at[0], pos + shift);
    $notes.setSelectionRange(caret, caret);
    $notes.focus();
    growNotes();
    saveSoon();
  }

  document.getElementById("bullet-btn").onclick = toggleBullet;

  $notes.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if ($notes.selectionStart !== $notes.selectionEnd) return;
    var v = $notes.value;
    var pos = $notes.selectionStart;
    var at = lineAround(v, pos);
    var line = v.slice(at[0], at[1]);
    if (!/^•\s?/.test(line)) return;      // not a bullet: let return do its normal thing
    e.preventDefault();
    if (!line.replace(/^•\s?/, "").trim()) {
      // Return on an empty bullet ends the list rather than making another one.
      $notes.value = v.slice(0, at[0]) + v.slice(at[1]);
      $notes.setSelectionRange(at[0], at[0]);
    } else {
      $notes.value = v.slice(0, pos) + "\n• " + v.slice(pos);
      $notes.setSelectionRange(pos + 3, pos + 3);
    }
    growNotes();
    saveSoon();
  });

  $notes.addEventListener("input", function () { growNotes(); saveSoon(); });
  $sheetTitle.addEventListener("input", saveSoon);
  $sheetTitle.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $sheetTitle.blur(); }
  });

  document.getElementById("scrim").onclick = closeSheet;
  document.getElementById("sheet-done").onclick = closeSheet;
  document.getElementById("sheet-delete").onclick = function () {
    var id = sheetId;
    sheetId = null;                        // closing must not re-save a deleted task
    clearTimeout(saveTimer);
    $sheetWrap.classList.remove("open");
    setTimeout(function () { $sheetWrap.hidden = true; }, 240);
    removeTask(id);
  };

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && sheetId) closeSheet();
  });

  /* ── boot ───────────────────────────────────────────────────────────── */

  // Bring every daily task up to today before the first paint.
  if (rollDailies()) { state.updatedAt = Date.now(); writeLocal(state); }

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
    if (rollDailies()) { commit(); return; }   // commit already re-renders
    renderBoard();
    renderCounts();
  }, 60000);

  connect();
  askForNotifications();

  if ("serviceWorker" in navigator && document.querySelector('link[rel="manifest"]')) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* not served over https */ });
    });
  }
})();
