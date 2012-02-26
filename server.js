#!/usr/local/bin/node

var irc = require("irc"),
    fs = require('fs'),
    http = require("http"),
    url = require("url");

function help() {
  console.log("usage: " + process.argv[1] + " <server> <nick> <channel>");
  process.exit(1);
}

if (process.argv.length < 5) help();

var server = process.argv[2];
var nick = process.argv[3];
var channel = process.argv[4];
var port = 8080;

var debug = true;
var timeWidth = 10;

for (var i = 5; i < process.argv.length; ++i) {
  var arg = process.argv[i];
  if (arg == "--port" && i + 1 < process.argv.length) {
    port = Number(process.argv[++i]);
  } else help();
}

var logFile = "log_" + server + "_" + channel + ".txt";

var output = fs.createWriteStream(logFile, {flags: "a"});

var ircClient;
function openIRC(backoff) {
  console.log("Connecting to " + server);
  var client = ircClient = new irc.Client(server, nick, {
    realName: "Presence bot",
    channels: ["#" + channel]
  });

  client.addListener("registered", function(message) {
    console.log("Connected to " + server + (message ? ": " + message : ""));
  });
  client.addListener("pm", function(from, message) {
    logLine(">", from + ": " + message);
  });
  client.addListener("message#" + channel, function(from, message) {
    logLine("_", from + ": " + message);
  });
  client.addListener("error", function(message) {
    console.log("Error from " + server + (message ? ": " + message.command : ""));
    try { client.disconnect(); } catch(e) {}
    backoff = Math.max(30, backoff || 2);
    setTimeout(openIRC.bind(null, backoff * 2), backoff)
  });
}
//openIRC();

function time() {
  return Math.floor((new Date).getTime() / 1000);
}
function timeAt(str, pos) {
  return Number(str.slice(pos, pos + timeWidth));
}

var recentActivity = [], recentActivityStart = time();
var maxActivityLen = 2000;

function logLine(tag, str) {
  var line = time() + " " + tag + " " + str + "\n";
  output.write(line);
  recentActivity.push(line);
  waiting.forEach(function(w) {sendText(w.resp, line);});
  waiting = [];
  if (recentActivity.length > maxActivityLen) {
    recentActivity.splice(0, maxActivityLen >> 1);
    recentActivityStart = timeAt(recentActivity[0], 0);
  }
}

// Do a binary search through the log files to lift out the part that
// we're interested in. This gets a bit clunky with asynchronous I/O.
function getHistoryOnDisk(from, to, c) {
  var fd = fs.openSync(logFile, "r"), len = fs.fstatSync(fd).size;
  var buf = new Buffer(256);

  function findLine(at, c) {
    if (at == len) return c(at);
    var bytes = Math.min(256, len - at);
    fs.read(fd, buf, 0, bytes, at, function() {
      var str = buf.toString("utf8", 0, bytes);
      var lineStart = str.indexOf("\n");
      if (lineStart == -1) findLine(at + 256, c);
      else if (lineStart > 255 - timeWidth) findLine(at + lineStart, c);
      else c(at + lineStart, timeAt(str, lineStart + 1));
    });
  }

  function findPos(time, startAt, c) {
    var lo = startAt, hi = len;
    (function step() {
      if (hi - lo < 256)
        fs.read(fd, buf, 0, hi - lo, lo, function() {
          var str = buf.toString("utf8", 0, hi - lo), i = 0;
          for (;;) {
            var time_here = timeAt(str, i);
            if (time_here >= time) break;
            last = i;
            var next = str.indexOf("\n", i + 1);
            if (next == -1) break;
            i = next + 1;
          }
          c(lo + i);
        });
      else findLine((lo + hi) >> 1, function(pos, time_at_pos) {
        if (time_at_pos < time) lo = pos;
        else if (pos == hi) hi = ((lo + hi) >> 1) - 1;
        else hi = pos;
        step();
      });
    }());
  }

  function getRange(start, end) {
    if (start == end) { fs.closeSync(fd); return c(""); }
    buf = new Buffer(end - start);
    fs.read(fd, buf, 0, end - start, start, function() {
      fs.closeSync(fd);
      c(buf.toString());
    });
  }

  findPos(from, 0, function(start) {
    if (!to) getRange(start, len);
    else findPos(to, start, function(end) {
      getRange(start, end);
    });
  });
}

function getHistoryCached(from, to) {
  var result = "", start = 0, end = recentActivity.length;
  for (var i = end - 1; i >= 0; --i) {
    var t = timeAt(recentActivity[i], 0);
    if (to && t >= to) end = i - 1;
    if (t < from) { start = i + 1; break; }
  }
  for (var i = start; i < end; ++i)
    result += recentActivity[i];
  return result;
}

function getHistory(from, to, c) {
  if (from > recentActivityStart) c(getHistoryCached(from, to));
  else getHistoryOnDisk(from, to, c);
}

// HTTP server

// Requests waiting for data
var waiting = [];

setInterval(function() {
  var cutOff = (new Date).getTime() - 40000;
  for (var i = 0; i < waiting.length; ++i) {
    if (waiting[i].since < cutOff) {
      sendText(waiting[i].resp, "");
      waiting.splice(i--, 1);
    }
  }
}, 10000);

function getData(obj, c) {
  var received = [];
  obj.setEncoding("utf8");
  obj.addListener("data", function(chunk) {received.push(chunk);});
  obj.addListener("end", function() {c(received.join(""));});
}

var clientFile = {}, mimes = {"html": "text/html", "js": "application/javascript", "css": "text/css"};
fs.readdirSync("client").forEach(function(file) {
  clientFile[file] = {mime: mimes[file.split(".").pop()] || "text/plain",
                      data: fs.readFileSync("client/" + file, "utf8")};
});

function htmlEsc(text) {
  var HTMLspecial = {"<": "&lt;", "&": "&amp;", "\"": "&quot;"};
  return String(text).replace(/[<&\"]/g, function(ch) {return HTMLspecial[ch];});
}

function instantiate(file, values) {
  var str = clientFile[file].data;
  for (key in values)
    str = str.replace(new RegExp("\\$" + key + "\\$", "g"), htmlEsc(values[key]));
  return str;
}

function err(resp, code, title, detail) {
  resp.writeHead(code, {"Content-Type": "text/html"});
  resp.write(instantiate("error.html", {title: title, detail: detail}));
  resp.end();
}

function sendText(resp, text) {
  resp.writeHead(200, {"Content-Type": "text/plain"});
  resp.write(text);
  resp.end();
}

http.createServer(function(req, resp) {
  var u = url.parse(req.url, true);
  var path = u.pathname.slice(1);
  if (req.method == "GET" && path == "") {
    resp.writeHead(200, {"Content-Type": "text/html"});
    resp.write(instantiate("index.html", {nick: nick, chan: channel, server: server}));
    resp.end();
  } else if (req.method == "POST" && path == "send") {
    var command = u.query.cmd, args = u.query.arg || [];
    if (typeof args == "string") args = [args];
    if (command == null) {
      err(resp, 400, "Missing parameter", "The 'cmd' parameter must be provided.");
      return;
    }
    getData(req, function(body) {
      body = body.replace(/[\n\r]/g, "");
      if (command == "PRIVMSG") {
        if (args[0] == "#" + channel)
          logLine("_", nick + ": " + body);
        else
          logLine("<", args[0] + ": " + body);
      }
      args.unshift(command);
      args.push(body);
      if (ircClient) ircClient.send.apply(ircClient, args);
      resp.writeHead(204, {});
      resp.end();
    });
  } else if (req.method == "GET" && path == "history") {
    var from = Number(u.query.from), to = u.query.to ? Number(u.query.to) : null;
    if (!from || isNaN(from) || isNaN(to)) {
      err(resp, 400, "Missing parameter", "The 'from' and 'to' parameter must be provided and hold numeric values");
      return;
    }
    getHistory(from, to, function(history) {
      if (history || to) sendText(resp, history);
      else waiting.push({since: (new Date).getTime(), resp: resp});
    });
  } else if (req.method == "GET" && clientFile.hasOwnProperty(path)) {
    var info = clientFile[path];
    resp.writeHead(200, {"Content-Type": info.mime});
    resp.write(debug ? fs.readFileSync("client/" + path) : info.data);
    resp.end();
  } else {
    err(resp, 404, "Not found", u.pathname + " does not support " + req.method + " requests");
  }
}).listen(port, "localhost");
