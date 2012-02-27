#!/usr/local/bin/node

var irc = require("irc"), fs = require("fs"), http = require("http"), url = require("url");

var arg1Parts = process.argv[1].split("/");
var scriptName = arg1Parts.pop();
var myPath = (arg1Parts.join("/") || ".") + "/";
function help() {
  console.log("usage: " + arg1Parts[arg1Parts.length-1] + " <server> <nick> <channel>\n" +
              "         [--port <http port>]\n" +
              "         [--realname <name>]\n" +
              "         [--outputdir <dir>]");
  process.exit(1);
}

if (process.argv.length < 5) help();

var server = process.argv[2];
var nick = process.argv[3];
var channel = "#" + process.argv[4];
var port = 8080;
var realName = "Presence bot";
var outputDir = "./";

var debug = true;
var timeWidth = 10;

for (var i = 5; i < process.argv.length; ++i) {
  var arg = process.argv[i], more = i + 1 < process.argv.length;
  if (arg == "--port" && more) {
    port = Number(process.argv[++i]);
  } else if (arg == "--realname" && more) {
    realName = process.argv[++i];
  } else if (arg == "--outputdir" && more) {
    outputDir = process.argv[++i];
    if (outputDir.charAt(outputDir.length - 1) != "/") outputDir += "/";
  } else help();
}

var logFile = outputDir + "log_" + channel.slice(1) + ".txt",
    bookmarkFile = outputDir + "bookmark_" + channel.slice(1) + ".txt";

var output = fs.createWriteStream(logFile, {flags: "a"});

var ircClient, ircClientOK = false;
function openIRC(backoff) {
  backoff = backoff || 1;
  console.log("Connecting to " + server);
  var client = ircClient = new irc.Client(server, nick, {
    realName: realName,
    channels: [channel]
  });

  client.addListener("registered", function(message) {
    backoff = 1;
    console.log("Connected to " + server + (message ? ": " + message : ""));
    ircClientOK = true;
  });
  client.addListener("pm", function(from, text) {
    logLine(">", from + ": " + text);
  });
  client.addListener("message" + channel, function(from, text) {
    logLine("_", from + ": " + text);
  });
  client.addListener("error", function(message) {
    if (message && message.command == "err_nosuchnick") {
      notifyWaiting("whois " + message.args[1], "");
      return;
    }
    ircClientOK = false;
    console.log("Error from " + server + (message ? ": " + message.command : ""));
    try { client.disconnect(); } catch(e) {}
    setTimeout(openIRC.bind(null, Math.max(30, backoff) * 2), backoff)
  });
  client.addListener("names", function(channel, nicks) {
    notifyWaiting("names", Object.keys(nicks).join(" "));
  });
  client.addListener("join" + channel, function(nick) {
    logLine("+", nick + ": joined");
  });
  client.addListener("part" + channel, function(nick) {
    logLine("-", nick + ": parted");
  });
  client.addListener("quit", function(nick, reason, channels) {
    if (channels.indexOf(channel) > -1) logLine("-", nick + ": " + reason);
  });
  client.addListener("kick" + channel, function(nick, by, reason) {
    logLine("-", nick + ": " + reason);
  });
  client.addListener("kill", function(nick, reason, channels) {
    if (channels.indexOf(channel) > -1) logLine("-", nick + ": " + reason);
  });
  client.addListener("notice", function(nick, to, text) {
    logLine("n", (nick || "") + ": " + text);
  });
  client.addListener("nick", function(oldnick, newnick) {
    logLine("x", oldnick + ": " + newnick);
  });
  client.addListener("whois", function(info) {
    if (info) notifyWaiting("whois " + info.nick, JSON.stringify(info));
  });
}
openIRC();

function time() {
  return Math.floor((new Date).getTime() / 1000);
}
function timeAt(str, pos) {
  return Number(str.slice(pos, pos + timeWidth));
}

var recentActivity = [], recentActivityStart = time();
var maxActivityLen = 200;

var bookmark = 0, savingBookmark = false;
fs.readFile(bookmarkFile, function(err, bm) { if (!err) bookmark = Number(bm); });
function setBookmark(val) {
  bookmark = val;
  if (!savingBookmark) {
    savingBookmark = true;
    setTimeout(function() {
      savingBookmark = false;
      fs.writeFile(bookmarkFile, String(bookmark));
    }, 5000);
  }
}

function logLine(tag, str) {
  var line = time() + " " + tag + " " + str + "\n";
  output.write(line);
  recentActivity.push(line);
  notifyWaiting("history", line);
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

function addWaiting(type, resp) {
  waiting.push({since: (new Date).getTime(), type: type, resp: resp});
}
function notifyWaiting(type, value) {
  for (var i = 0; i < waiting.length; ++i) {
    if (waiting[i].type == type) {
      sendText(waiting[i].resp, value);
      waiting.splice(i--, 1);
    }
  }
}

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
fs.readdirSync(myPath + "client").forEach(function(file) {
  clientFile[file] = {mime: mimes[file.split(".").pop()] || "text/plain",
                      data: fs.readFileSync(myPath + "client/" + file, "utf8")};
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
  var u = url.parse(req.url, true), m;
  var path = u.pathname.slice(1);
  if (req.method == "GET" && path == "") {
    resp.writeHead(200, {"Content-Type": "text/html"});
    resp.write(instantiate("index.html", {nick: nick, chan: channel}));
    resp.end();
  } else if (req.method == "POST" && (m = path.match(/^send\/([^\/]+)(?:\/(.*))?$/))) {
    if (!ircClientOK) return err(resp, 500, "No IRC connection");
    var command = decodeURIComponent(m[1]);
    var args = m[2] ? m[2].split("/").map(decodeURIComponent) : [];
    getData(req, function(body) {
      body = body.replace(/[\n\r]/g, "");
      if (command == "PRIVMSG") {
        if (args[0] == channel)
          logLine("_", nick + ": " + body);
        else
          logLine("<", args[0] + ": " + body);
      }
      args.unshift(command);
      args.push(body);
      ircClient.send.apply(ircClient, args);
      resp.writeHead(204, {});
      resp.end();
    });
  } else if (req.method == "GET" && path == "names") {
    if (!ircClientOK) return err(resp, 500, "No IRC connection");
    ircClient.send("NAMES", channel);
    addWaiting("names", resp);
  } else if (req.method == "GET" && (m = path.match(/^whois\/(.*)$/))) {
    if (!ircClientOK) return err(resp, 500, "No IRC connection");
    var name = decodeURIComponent(m[1]);
    ircClient.send("WHOIS", m[1]);
    addWaiting("whois " + name, resp);
  } else if (req.method == "GET" && path == "history") {
    var from = Number(u.query.from), to = u.query.to ? Number(u.query.to) : null;
    if (!from || isNaN(from) || isNaN(to)) {
      err(resp, 400, "Missing parameter", "The 'from' and 'to' parameter must be provided and hold numeric values");
      return;
    }
    getHistory(from, to, function(history) {
      if (u.query.skip && !isNaN(Number(u.query.skip))) {
        var pos = 0;
        for (var i = Number(u.query.skip); i > 0; --i) {
          var nl = history.indexOf("\n", pos);
          if (nl == -1) { pos = history.length; break; }
          pos = nl + 1;
        }
        history = history.slice(pos);
      }
      if (history || to) sendText(resp, history);
      else addWaiting("history", resp);
    });
  } else if (req.method == "GET" && path == "bookmark") {
    sendText(resp, String(bookmark));
  } else if (req.method == "PUT" && path == "bookmark") {
    getData(req, function(body) {
      var val = Number(body);
      if (!val || isNaN(val)) return err(resp, 400, "Not a valid bookmark");
      if (val > bookmark || u.query.hasOwnProperty("force")) setBookmark(val);
      resp.writeHead(204, {});
      resp.end();
    });
  } else if (req.method == "GET" && clientFile.hasOwnProperty(path)) {
    var info = clientFile[path];
    resp.writeHead(200, {"Content-Type": info.mime});
    resp.write(debug ? fs.readFileSync(myPath + "client/" + path) : info.data);
    resp.end();
  } else {
    err(resp, 404, "Not found", u.pathname + " does not support " + req.method + " requests");
  }
}).listen(port, "localhost");
