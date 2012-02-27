// Initialization
window.onload = function() {
  var input = $("input");
  connect(input, "keydown", function(e) {
    if (closeStatusOnInput) setStatus("");
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
        console.log(cur, start, val);
        var completions = [], frag = val.slice(start, cur);
        if (start && val.charAt(start - 1) == "/") {
          --start;
          forEachIn(commands, function(key) {
            if (key.slice(0, frag.length) == frag) completions.push("/" + key);
          });
        } else {
          forEachIn(curState.names, function(key) {
            if (key.slice(0, frag.length) == frag) completions.push(key + ":");
          });
        }
        if (completions.length == 1) {
          complete(start, completions[0]);
        } else if (completions.length > 1) {
          var html = "<div class=completions data-start=" + start + ">";
          forEach(completions, function(c) { console.log(c); html += "<div>" + htmlEsc(c) + "</div>"; })
          setStatus(html + "</div>", true);
        }
      }
    }
  });
  connect($("statusclose"), "click", function(e) {setStatus("");});
  connect(document.body, "click", function(e) {
    if (e.target.parentNode.className == "names") whoIs(e.target.innerText);
    else if (e.target.className == "name") whoIs(e.target.innerText);
    else if (e.target.parentNode.className == "completions")
      complete(Number(e.target.parentNode.getAttribute("data-start")), e.target.innerText);
  });
  fetchData();
};

function complete(start, text) {
  var input = $("input"), end = input.selectionStart, val = input.value;
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
}

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

var sendDepth = 0;
function startSend() {
  if (!sendDepth) $("input").style.background = "#eee";
  sendDepth++;
}
function stopSend() {
  sendDepth--;
  if (!sendDepth) $("input").style.background = "";
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

var knownHistory = [], knownUpto;

function fetchData() {
  var start = Math.floor((new Date).getTime() / 1000) - 3600 * 24;
  getHistory(start, null, null, function(history) {
    knownHistory = history.split("\n");
    knownHistory.pop();
    if (knownHistory.length)
      knownUpto = timeFor(knownHistory[knownHistory.length - 1]);
    repaint();
    getNames(function(names) {
      curState.names = {};
      forEach(names.split(" "), function(name) {curState.names[name] = true;});
      poll();
    }, function() {poll();});
  }, function(msg) {
    document.body.innerHTML = "Failed to connect to Presence server (" + msg + ")";
  });
}

var closeStatusOnInput = false;
function setStatus(html, closeOnInput) {
  var atBottom = isScrolledToBottom();
  closeStatusOnInput = closeOnInput;
  $("status").innerHTML = html;
  $("statuswrap").style.height = $("status").offsetHeight + "px";
  if (atBottom && html) var tick = 0, scroll = setInterval(function() {
    document.body.scrollTop = document.body.scrollHeight;
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

var colors = {}, selfColor = "silver";
function getColor(name) {
  if (name == nick) return selfColor;
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

var scratchDIV = document.createElement("div");
function htmlEsc(s) {
  scratchDIV.textContent = s;
  return scratchDIV.innerHTML;
}

var curState = {prevName: null, names: {}};

function processLine(state, line) {
  var type = line.charAt(11), html = "";
  var col = line.indexOf(":", 13);
  if (col > -1) var name = line.slice(13, col), msg = line.slice(col + 2);
  else var msg = line.slice(13);

  if (type == "_" || type == ">" || (type == "n" && name)) {
    var newName = state.prevName != name;
    html += "<div style=\"border-left: 2px solid " + getColor(name) +
      (newName ? "; margin-top: 1px" : "") + "\"" + (type == ">" ? " class=priv" : "") + ">";
    if (newName) {
      state.prevName = name;
      html += "<div class=name>" + htmlEsc(name) + "</div>";
    }
    var act = msg.match(/^\01ACTION (.*)\01$/);
    if (act) html += "<em>" + htmlEsc(act[1]) + "</em></div>"
    else  html += htmlEsc(msg) + "</div>"
  } else if (type == "<") {
    state.lastDirect = name;
    var newName = state.prevName != "to " + name;
    html += "<div style=\"border-left: 2px solid " + selfColor +
      (newName ? "; margin-top: 1px" : "") + "\" class=priv>";
    if (newName) {
      state.prevName = "to " + name;
      html += "<div class=name>⇝" + htmlEsc(name) + "</div>";
    }
    html += htmlEsc(msg) + "</div>"
  } else if (type == "+") {
    state.names[name] = true;
  } else if (type == "-") {
    state.names[name] = false;
  } else if (type == "x") {
    state.names[name] = false;
    state.names[msg] = true;
  }
  return html;
}

function repaint() {
  var html = "";
  for (var i = 0, e = knownHistory.length; i < e; ++i)
    html += processLine(curState, knownHistory[i]);
  $("output").innerHTML = html;
}

function isScrolledToBottom() {
  var scrolled = window.pageYOffset || document.body.scrollTop || document.documentElement.scrollTop;
  var winHeight = window.innerHeight || document.documentElement.clientHeight;
  var bodyHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  return scrolled + winHeight >= bodyHeight - 2;
}

function addLines(lines) {
  var atBottom = isScrolledToBottom();
  if (!lines) return;
  lines = lines.split("\n");
  lines.pop();
  knownUpto = timeFor(lines[lines.length - 1]);
  var html = "", output = $("output");
  for (var i = 0; i < lines.length; ++i) {
    html += processLine(curState, lines[i]);
    knownHistory.push(lines[i]);
  }
  scratchDIV.innerHTML = html;
  while (scratchDIV.firstChild) output.appendChild(scratchDIV.firstChild);
  if (atBottom) document.body.scrollTop = document.body.scrollHeight;
}

function poll(backOff) {
  var skip = 0;
  while (skip < knownHistory.length &&
         timeFor(knownHistory[knownHistory.length - 1 - skip]) == knownUpto)
    ++skip;
  getHistory(knownUpto, null, skip, function(lines) {
    addLines(lines);
    poll();
  }, function() {
    var time = Math.min((backOff || 2) * 2, 30);
    setTimeout(function() {poll(time);}, time * 1000);
  });
}
