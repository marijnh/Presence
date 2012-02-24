#!/usr/local/bin/node

var irc = require("irc"),
    fs = require('fs'),
    http = require("http"),
    url = require("url"),
    mold = require("mold/mold.node");

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
    logLine("!<" + from + ">: " + message);
  });
  client.addListener("message#" + channel, function(from, message) {
    logLine("<" + from + ">: " + message);
  });
  client.addListener("error", function(message) {
    console.log("Error from " + server + (message ? ": " + message.command : ""));
    try { client.disconnect(); } catch(e) {}
    backoff = Math.max(30, backoff || 2);
    setTimeout(openIRC.bind(null, backoff * 2), backoff)
  });
}
//openIRC();

function logLine(str) {
  output.write(Math.floor((new Date).getTime() / 1000) + " " + str + "\n");
}

// Do a binary search through the log files to lift out the part that
// we're interested in. This gets a bit clunky with asynchronous I/O.
function getHistory(from, to, c) {
  var fd = fs.openSync(logFile, "r"), len = fs.fstatSync(fd).size;
  var buf = new Buffer(256);

  function findLine(at, c) {
    if (at == len) return c(at);
    fs.read(fd, buf, 0, Math.min(256, len - at), at, function() {
      var str = buf.toString();
      var lineStart = str.indexOf("\n");
      if (lineStart == -1) findLine(at + 256, c);
      else if (lineStart > 255 - timeWidth) findLine(at + lineStart, c);
      else c(at + lineStart, Number(str.slice(lineStart + 1, lineStart + 1 + timeWidth)));
    });
  }

  function findPos(time, c) {
    var lo = 0, hi = len;
    (function step() {
      if (lo == hi) return c(lo);
      findLine((lo + hi) >> 1, function(pos, time1) {
        if (time1 < time) lo = pos;
        else if (pos == hi) return findLine(lo + 1, c);
        else hi = pos;
        step();
      });
    }());
  }

  findPos(from, function(start) {
    if (!to) c(start, len);
    else findPos(to, function(end) {
      c(start, end);
    });
  });
}

// HTTP server

function getData(obj, c) {
  var received = [];
  obj.setEncoding("utf8");
  obj.addListener("data", function(chunk) {received.push(chunk);});
  obj.addListener("end", function() {c(received.join(""));});
}

var template = {}, staticFile = {},
    mimes = {"html": "text/html", "js": "application/javascript", "css": "text/css"};
fs.readdirSync("templates").forEach(function(tmpl) {
  template[tmpl] = mold.bake(fs.readFileSync("templates/" + tmpl, "utf8"));
});
fs.readdirSync("static").forEach(function(file) {
  staticFile[file] = {mime: mimes[file.split(".").pop()] || "text/plain",
                      data: fs.readFileSync("static/" + file, "utf8")};
});

function err(resp, code, title, detail) {
  resp.writeHead(code, {"Content-Type": "text/html"});
  resp.write(template.error({title: title, detail: detail || ""}));
  resp.end();
}

http.createServer(function(req, resp) {
  var u = url.parse(req.url, true);
  var path = u.pathname.slice(1);
  if (req.method == "GET" && path == "") {
    resp.writeHead(200, {"Content-Type": "text/html"});
    resp.write(template.index({channel: JSON.stringify(channel)}));
    resp.end();
  } else if (req.method == "POST" && path == "send") {
    var command = u.query.cmd, args = u.query.arg || [];
    if (typeof args == "string") args = [args];
    if (command == null) {
      err(resp, 400, "Missing parameter", "The 'cmd' parameter must be provided.");
      return;
    }
    getData(req, function(body) {
      if (command == "PRIVMSG" && args[0] == "#" + channel)
        logLine("<" + nick + "> " + body);
      args.unshift(command);
      args.push(body);
      ircClient.send.apply(ircClient, args);
      resp.writeHead(204, {});
      resp.end();
    });
  } else if (req.method == "GET" && path == "history") {
    var from = Number(u.query.from), to = Number(u.query.to);
    if (!from || isNaN(from) || isNaN(to)) {
      err(resp, 400, "Missing parameter", "The 'from' and 'to' parameter must be provided and hold numeric values");
      return;
    }
    var history = getHistory(from, to);
    resp.writeHead(200, {"Content-Type": "text/plain"});
    resp.write(history);
    resp.end();
  } else if (req.method == "GET" && staticFile.hasOwnProperty(path)) {
    var info = staticFile[path];
    resp.writeHead(200, {"Content-Type": info.mime});
    resp.write(debug ? fs.readFileSync("static/" + path) : info.data);
    resp.end();
  } else {
    err(resp, 404, "Not found", u.pathname + " does not support " + req.method + " requests");
  }
}).listen(port, "localhost");
