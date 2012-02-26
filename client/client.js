// Initialization
window.onload = function() {
  var input = $("input");
  connect(input, "keypress", function(e) {
    if (e.keyCode == 13 && !e.shiftKey) {
      var val = input.value;
      if (!val) return;
      input.value = "";
      forEach(val.split(/\r?\n/g), function(line) {
        startSend();
        sendCommand("PRIVMSG", ["#" + channel], line, stopSend);
      });
      e.preventDefault();
    }
  });
  fetchData();
};

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

function sendCommand(cmd, args, body, done, backOff) {
  var url = document.location.href + "send/" + encodeURIComponent(cmd);
  for (var i = 0; i < args.length; ++i)
    url += "/" + encodeURIComponent(args[i]);
  httpRequest(url, {body: body, method: "POST"}, function() {done();}, function(msg) {
    console.log("Sending failed: " + msg);
    var time = Math.min((backOff || 2) * 2, 30);
    setTimeout(function() {sendCommand(cmd, args, done, time);}, time * 1000);
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

var colors = {}, selfColor = "#8e98ff";
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
  if (col > -1) var name = line.slice(13, col), msg = line.slice(col + 1);
  else var msg = line.slice(13);

  if (type == "_" || type == ">" || (type == "n" && name)) {
    var newName = state.prevName != name;
    html += "<div style=\"border-left: 2px solid " + getColor(name) +
      (newName ? "; margin-top: 1px" : "") + "\"" + (type == ">" ? " class=priv" : "") + ">";
    if (newName) {
      state.prevName = name;
      html += "<div class=name>" + htmlEsc(name) + "</div>";
    }
    html += htmlEsc(msg) + "</div>"
  } else if (type == "<") {
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
