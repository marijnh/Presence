// Initialization
window.onload = function() {
  var input = $("input").getElementsByTagName("INPUT")[0];
  connect(input, "keypress", function(e) {
    if (e.keyCode == 13) {
      var val = input.value;
      if (!val) return;
      input.value = "";
      sendCommand("PRIVMSG", "#" + channel, val);
      e.preventDefault();
    }
  });
};

// API wrappers

function failed(xhr, err) {
  // FIXME
  alert("BAD! " + err);
}

function sendCommand(cmd, args) {
  var url = document.location.href + "send?cmd=" + encodeURIComponent(cmd);
  var body = arguments[arguments.length - 1];
  for (var i = 1; i < arguments.length - 1; ++i)
    url += "&arg=" + encodeURIComponent(arguments[i]);
  console.log(url);
  httpRequest(url, {body: body, method: "POST"}, function() {console.log("OK");}, failed);
}

function getHistory(from, to, c) {
  httpRequest(document.location.href + "history?from=" + from + (to ? "to=" + to : ""),
              {}, function(lines) { c(lines.split("\n")); }, failed);
}

function fetchHistory() {

}