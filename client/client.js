// Initialization
window.onload = function() {
  var input = $("input");
  connect(input, "keypress", function(e) {
    if (e.keyCode == 13 && !e.shiftKey) {
      var val = input.value;
      if (!val) return;
      input.value = "";
      forEach(val.split(/\r?\n/g), function(line) {
        sendCommand("PRIVMSG", "#" + channel, line);
      });
      e.preventDefault();
    }
  });
  fetchHistory();
};

function time() {
  return Math.floor((new Date).getTime() / 1000);
}
function timeFor(str) {
  return Number(str.slice(0, 10));
}

// API wrappers

function failed(msg, xhr) {
  // FIXME
  alert("BAD! " + msg);
}

function sendCommand(cmd, args) {
  var url = document.location.href + "send?cmd=" + encodeURIComponent(cmd);
  var body = arguments[arguments.length - 1];
  for (var i = 1; i < arguments.length - 1; ++i)
    url += "&arg=" + encodeURIComponent(arguments[i]);
  httpRequest(url, {body: body, method: "POST"}, function() {}, failed);
}

function getHistory(from, to, skip, c, err) {
  httpRequest(document.location.href + "history?from=" + from +
              (to ? "&to=" + to : "") + (skip ? "&skip=" + skip : ""),
              {}, c, err);
}

var knownHistory = [], knownUpto = time();

function fetchHistory() {
  getHistory(knownUpto - (3600 * 24), null, null, function(history) {
    knownHistory = history.split("\n");
    knownHistory.pop();
    if (knownHistory.length)
      knownUpto = timeFor(knownHistory[knownHistory.length - 1]);
    repaint();
    poll();
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

var colors = {};
function getColor(name) {
  if (name == nick) return "#8e98ff";
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

var prevName;
function renderLine(line) {
  var type = line.charAt(11), html = "";
  if (type == "_" || type == ">") {
    var col = line.indexOf(":", 13);
    var name = line.slice(13, col), msg = line.slice(col + 1);
    html += "<div style=\"border-left: 2px solid " + getColor(name) +
      (name != prevName ? "; margin-top: 1px" : "") + "\">";
    if (name != prevName) {
      prevName = name;
      html += "<div class=name>" + htmlEsc(name) + "</div>";
    }
    html += htmlEsc(msg) + "</div>"
  }
  return html;
}

function repaint() {
  var html = "";
  for (var i = 0, e = knownHistory.length; i < e; ++i)
    html += renderLine(knownHistory[i]);
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
  var l1 = lines[0], t1 = timeFor(l1);
  // Strip out lines we already saw
  for (var i = knownHistory.length - 1; i >= 0; --i) {
    var knownLine = knownHistory[i];
    if (knownLine == l1) { lines.splice(0, knownHistory.length - i); break; }
    if (timeFor(knownLine) < t1) { break; }
  }
  var html = "", output = $("output");
  for (var i = 0; i < lines.length; ++i) {
    html += renderLine(lines[i]);
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
