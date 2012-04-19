var input, output;

// Initialization
window.onload = function() {
  input = document.getElementById("input");
  output = document.getElementById("output");

  connect(input, "keydown", function(e) {
    if (closeStatusOnInput) setStatus("");
    if (curState.unread.length) { curState.unread = []; updateTitle(); }
    if (e.keyCode == 13 && !e.shiftKey) {
      var val = input.value;
      if (!val) return;
      input.value = "";
      var cmd = val.match(/^\/(\w+)\b\s*(.*)$/);
      if (cmd && commands.hasOwnProperty(cmd[1])) {
        commands[cmd[1]](cmd[2]);
      } else {
        forEach(val.split(/\r?\n/g), function(line) {
          sendCommand("PRIVMSG", [channel], line);
        });
      }
      e.preventDefault();
    } else if (e.keyCode == 32 && e.ctrlKey) {
      e.preventDefault();
      var val = input.value;
      if (!val && curState.lastDirect) {
        var str = "/msg " + curState.lastDirect + " ";
        input.value = str;
        input.setSelectionRange(str.length, str.length);
      } else {
        var cur = input.selectionStart, start = cur;
        while (start && /\w/.test(val.charAt(start - 1))) --start;
        var completions = [], frag = val.slice(start, cur);
        if (start && val.charAt(start - 1) == "/") {
          --start;
          forEachIn(commands, function(key) {
            if (key.slice(0, frag.length) == frag) completions.push("/" + key);
          });
        } else {
          var appendCol = start ? "" : ":";
          forEachIn(curState.names, function(key) {
            if (curState.names[key] && key.slice(0, frag.length) == frag)
              completions.push(key + appendCol);
          });
        }
        if (completions.length == 1) {
          complete(start, completions[0]);
        } else if (completions.length > 1) {
          var html = "<div class=completions data-start=" + start + ">";
          forEach(completions, function(c) { html += "<div>" + htmlEsc(c) + "</div>"; })
          setStatus(html + "</div>", true);
        }
      }
    }
  });
  connect(document.getElementById("statusclose"), "click", function(e) {setStatus("");});
  connect(document.body, "click", function(e) {
    var pclass = e.target.parentNode && e.target.parentNode.className;
    if (pclass == "names") whoIs(e.target.innerText);
    else if (e.target.className == "name") whoIs(e.target.innerText);
    else if (pclass == "completions")
      complete(Number(e.target.parentNode.getAttribute("data-start")), e.target.innerText);
  });
  connect(window, "focus", function() { winFocused = true; })
  connect(window, "blur", function() { winFocused = false; })
  connect(document.getElementById("loadday"), "click", function(){loadMore(1);});
  connect(document.getElementById("loadweek"), "click", function(){loadMore(7);});
  connect(document.body, "mouseover", function(e) {
    if (e.target.parentNode == output) {
      var n = e.target.appendChild(document.createElement("div"));
      n.className = "date";
      n.innerHTML = renderTime(timeFor(e.target.logLine));
    }
  });
  connect(document.body, "mouseout", function(e) {
    if (e.target.parentNode == output && e.target.lastChild.className == "date")
      e.target.removeChild(e.target.lastChild);
  });
  connect(window, "scroll", scrolled);

  fetchData();
};

function complete(start, text) {
  var end = input.selectionStart, val = input.value;
  input.value = val.slice(0, start) + text + " " + val.slice(end);
  var cur = start + text.length + 1;
  input.setSelectionRange(cur, cur);
}

var commands = {
  "msg": function(line) {
    var m = line.match(/^\s*(\S+)\s+(.+)$/);
    if (m) sendCommand("PRIVMSG", [m[1]], m[2]);
  },
  "me": function(line) {
    sendCommand("PRIVMSG", [channel], "\01ACTION " + line + "\01");
  },
  "whois": whoIs,
  "names": function() {
    var html = "<div class=names>";
    forEachIn(curState.names, function(name, present) {
      if (present) html += "<div>" + htmlEsc(name) + "</div>";
    });
    setStatus(html + "</div>");
  }
};
var winFocused = true;

function whoIs(name) {
  startSend();
  getWhoIs(name.match(/^\s*(.*?)\s*$/)[1], function(info) {
    var nm = htmlEsc(name);
    stopSend();
    if (info == "") return setStatus("<strong>No such nick: " + nm + "</strong>");
    info = JSON.parse(info);
    var html = "";
    if (info.realname) html += nm + " is " + htmlEsc(info.realname) + "<br>";
    if (info.channels && info.channels.length)
      html += nm + " is on channels " + htmlEsc(info.channels.map(function (s) {
        return s.replace(/@/g, ""); }).join(", ")) + "<br>";
    if (info.host) html += "host: " + htmlEsc(info.host) + "<br>";
    if (info.server) html += "server: " + htmlEsc(info.server) + "<br>";
    setStatus(html);
  }, function(msg) {
    stopSend();
    setStatus("<strong>Failed to get whois info: " + htmlEsc(msg) + "</strong>");
  });
}

function timeFor(str) {
  return Number(str.slice(0, 10));
}
function renderTime(time) {
  var d = new Date(time * 1000);
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate() + " " +
    d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
}

var sendDepth = 0;
function startSend() {
  if (!sendDepth) input.className = "loading";
  sendDepth++;
}
function stopSend() {
  sendDepth--;
  if (!sendDepth) input.className = "";
}

// API wrappers

function sendCommand(cmd, args, body, backOff) {
  var url = document.location.href + "send/" + encodeURIComponent(cmd);
  for (var i = 0; i < args.length; ++i)
    url += "/" + encodeURIComponent(args[i]);
  startSend();
  httpRequest(url, {body: body, method: "POST"}, stopSend, function(msg) {
    console.log("Sending failed: " + msg);
    var time = Math.min((backOff || 2) * 2, 30);
    setTimeout(function() {sendCommand(cmd, args, time);}, time * 1000);
  });
}

function getHistory(from, to, skip, c, err) {
  httpRequest(document.location.href + "history?from=" + from +
              (to ? "&to=" + to : "") + (skip ? "&skip=" + skip : ""),
              {}, c, err);
}

function getNames(c, err) {
  httpRequest(document.location.href + "names", {}, c, err);
}

function getWhoIs(name, c, err) {
  httpRequest(document.location.href + "whois/" + encodeURIComponent(name), {}, c, err);
}

function getBookmark(c, err) {
  httpRequest(document.location.href + "bookmark", {}, c, err);
}
function setBookmark(val, force, c, err) {
  httpRequest(document.location.href + "bookmark" + (force ? "?force" : ""),
              {method: "PUT", body: String(val)}, c, err);
}

var knownHistory = [], knownUpto, knownFrom;

function fetchData() {
  var yesterday = Math.floor((new Date).getTime() / 1000) - 3600 * 24;
  function failed(msg) {
    document.body.innerHTML = "Failed to connect to Presence server (" + msg + ")";
  }
  getBookmark(function(bookmark) {
    var btime = Number(bookmark), from = Math.min(yesterday, btime);
    getHistory(from || 1, null, null, function(history) {
      knownHistory = history.split("\n");
      knownHistory.pop();
      if (knownHistory.length)
        knownUpto = timeFor(knownHistory[knownHistory.length - 1]);
      else knownUpto = from;
      knownFrom = from;
      repaint();

      if (output.firstChild) 
        for (var cur = output.firstChild; cur; cur = cur.nextSibling)
          if (timeFor(cur.logLine) >= btime) break;
      if (output.lastChild) window.scrollTo(0, maxScroll = (cur || output.lastChild).offsetTop - 10);

      getNames(function(names) {
        curState.names = {};
        forEach(names.split(" "), function(name) {curState.names[name] = true;});
        poll();
      }, function() {poll();});
    }, failed);
  }, failed);
}

function loadMore(days) {
  var elt = document.getElementById("loadmore");
  elt.className = "loading";
  var from = knownFrom - 3600 * 24 * days;
  getHistory(from, knownFrom, null, function(history) {
    elt.className = "";
    var lines = history.split("\n");
    lines.pop();
    var tempState = {prevName: null, names: {}}, nodes = [];
    for (var i = 0, e = lines.length; i < e; ++i) {
      var node = processLine(tempState, lines[i]);
      if (node) nodes.push(node);
    }
    var height = bodyHeight();
    while (nodes.length) output.insertBefore(nodes.pop(), output.firstChild);
    window.scrollBy(0, bodyHeight() - height);
    lines.unshift(0);
    lines.unshift(0);
    knownHistory.splice.apply(knownHistory, lines);
    knownFrom = from;
  }, function() { elt.className = ""; });
}

var closeStatusOnInput = false;
function setStatus(html, closeOnInput) {
  var atBottom = isScrolledToBottom(), status = document.getElementById("status");
  closeStatusOnInput = closeOnInput;
  status.innerHTML = html;
  document.getElementById("statuswrap").style.height = status.offsetHeight + "px";
  if (atBottom && html) var tick = 0, scroll = setInterval(function() {
    window.scrollTo(0, document.body.scrollHeight);
    if (++tick == 11) clearInterval(scroll);
  }, 100);
}

function buildColor(hue, sat, light) {
  function hex(off) {
    var col = Math.cos((hue + off) * 2 * Math.PI) / 2 + .5;
    var t = ((.5 * (1 - sat)) + (col * sat)) * light;
    var s = Math.floor(Math.min(t, 1) * 255).toString(16);
    if (s.length == 1) return "0" + s;
    return s;
  }
  return "#" + hex(0) + hex(.33) + hex(.67);
}

var colors = {}, selfColor = "#34c2c9";
function getColor(name) {
  if (name == nick) return selfColor;
  while (name && !/[a-z]/.test(name.charAt(0))) name = name.slice(1);
  while (name && !/[a-z]/.test(name.charAt(name.length - 1))) name = name.slice(0, name.length - 1);
  var cached = colors[name];
  if (cached) return cached;

  // Crude string hash
  var h = 2984119;
  for (var i = 0, e = name.length; i < e; ++i)
    h = (h * 761) ^ name.charCodeAt(i);
  h = Math.abs(h);
  
  // Crude hash -> pretty color trick
  var hue = (h % 100) / 100;
  var sat = .5 + ((h >> 3) % 100) / 200;
  var light = .8 + (h % 15 - 5) / 10;
  var col = buildColor(hue, sat, light);
  colors[name] = col;
  return col;
}

var scratchDiv = document.createElement("div");
function htmlEsc(s) {
  scratchDiv.textContent = s;
  return scratchDiv.innerHTML;
}

var curState = {prevName: null, names: {}, unread: []};

function processLine(state, line) {
  var type = line.charAt(11), col = line.indexOf(":", 13);
  var name = line.slice(13, col), msg = line.slice(col + 2);

  function buildOutput(from, priv, direct, msg) {
    var newName = state.prevName != from;
    var html = "<div style=\"border-left: 2px solid " + getColor(from) +
      (newName ? "; margin-top: 2px" : "") + "\"" + (priv ? " class=priv" : "") + ">";
    if (newName) {
      state.prevName = from;
      html += "<div class=name>" + htmlEsc(from) + "</div>";
    }
    var act = msg.match(/^\01ACTION (.*)\01$/);
    var msgHTML = act ? "<em>" + htmlEsc(act[1]) + "</em>" : htmlEsc(msg);
    msgHTML = msgHTML.replace(new RegExp("\\b" + nick + "\\b", "gi"), function(match) {
      direct = true;
      return "<span class=mention>" + match + "</span>";
    });
    msgHTML = msgHTML.replace(/\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}\.|[a-z0-9.\-]+\.[a-z]{2,4}\/)(?:[^\s()<>]+)+[^\s`!()\[\]{};:'".,<>?])\b/g, function(url) {
      return "<a href=\"" + url + "\">" + url + "</a>";
    });
    html += msgHTML + "</div>";
    scratchDiv.innerHTML = html;
    var node = scratchDiv.firstChild;
    node.logLine = line;
    if (direct && state.unread) {
      state.unread.push(node);
      if (state == curState) updateTitle();
    }
    return node;
  }

  if (type == "_" || type == ">") {
    if (type == ">") curState.lastDirect = name;
    return buildOutput(name, type == ">", type == ">", msg);
  } else if (type == "<") {
    return buildOutput("⇝" + name, true, false, msg); 
  } else if (type == "+") {
    state.names[name] = true;
  } else if (type == "-") {
    state.names[name] = false;
  } else if (type == "x") {
    state.names[name] = false;
    state.names[msg] = true;
  }
}

function repaint() {
  output.innerHTML = "";
  for (var i = 0, e = knownHistory.length; i < e; ++i) {
    var node = processLine(curState, knownHistory[i]);
    if (node) output.appendChild(node);
  }
}

function updateTitle() {
  var msgs = curState.unread.length;
  document.title = channel + (msgs ? " (" + msgs + ")" : "");
}

function scrollTop() {
  return window.pageYOffset || document.body.scrollTop || document.documentElement.scrollTop;
}
function winHeight() {
  return window.innerHeight || document.documentElement.clientHeight;
}
function bodyHeight() {
  return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
}
function isScrolledToBottom() {
  return scrollTop() + winHeight() >= bodyHeight() - 2;
}

function timeAtScrollPos(at) {
  var lo = 0, hi = output.childNodes.length;
  var node = output.firstChild, pos = at + 12;
  if (!node) return 0;
  if (pos >= output.offsetTop + output.offsetHeight) {
    node = output.lastChild;
  } else if (pos > output.offsetTop) {
    while (true) {
      var mid = (lo + hi) >> 1;
      node = output.childNodes[mid];
      var top = node.offsetTop, bot = top + node.offsetHeight;
      if (top > pos) hi = mid;
      else if (bot >= pos || lo == mid) break;
      else lo = mid;
    }
  }
  return timeFor(node.logLine);
}
var maxScroll = 0, sendingScroll = false;
function scrolled() {
  var scroll = scrollTop();
  // Clear seen messages from unread list
  var endVis = scroll + winHeight() - 12;
  while (curState.unread.length) {
    var msg = curState.unread[0];
    if (msg.offsetTop + msg.offsetHeight < endVis) {
      curState.unread.shift();
      updateTitle();
    } else break;
  }
  if (scroll > maxScroll + 50) {
    maxScroll = scroll;
    if (!sendingScroll) {
      sendingScroll = true;
      setTimeout(function send() {
        var time = timeAtScrollPos(maxScroll);
        setBookmark(time, false, function() {sendingScroll = false;}, function() {
          setTimeout(send, 10000);
        });
      }, 1000);
    }
  }
}

function addLines(lines) {
  var atBottom = isScrolledToBottom();
  if (!lines) return;
  lines = lines.split("\n");
  lines.pop();
  knownUpto = timeFor(lines[lines.length - 1]);
  for (var i = 0; i < lines.length; ++i) {
    var node = processLine(curState, lines[i]);
    if (node) output.appendChild(node);
    knownHistory.push(lines[i]);
  }
  if (atBottom && winFocused) window.scrollTo(0, document.body.scrollHeight);
}

var pollGeneration = 0, lastPoll;
function poll() { poll_(pollGeneration, 2); }
function poll_(generation, backOff) {
  lastPoll = new Date().getTime();
  var skip = 0;
  while (skip < knownHistory.length &&
         timeFor(knownHistory[knownHistory.length - 1 - skip]) == knownUpto)
    ++skip;
  getHistory(knownUpto, null, skip, function(lines) {
    if (pollGeneration != generation) return;
    addLines(lines);
    poll_(generation, 2);
  }, function(msg) {
    if (pollGeneration != generation) return;
    console.log("Polling failed: " + msg);
    var time = Math.min(backOff * 2, 30);
    setTimeout(function() {poll_(generation, time);}, time * 1000);
  });
}

// Try to notice when the computer has gone to sleep and resumed
// again, which tends to kill long-polling requests, or some other
// circumstance has messed with our polling.
setInterval(function() {
  var now = new Date().getTime();
  if (now - lastPoll > 90000) {
    console.log("Resetting polling");
    ++pollGeneration;
    poll();
  }
}, 60000);
