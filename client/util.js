var Util = {
  // Events
  // Standardize a few unportable event properties.
  normalizeEvent: function normalizeEvent(event) {
    if (!event.stopPropagation) {
      event.stopPropagation = function() {this.cancelBubble = true;};
      event.preventDefault = function() {this.returnValue = false;};
    }
    if (!event.stop) {
      event.stop = function() {
        this.stopPropagation();
        this.preventDefault();
      };
    }
    if (event.pageX == undefined && event.clientX) {
      event.pageX = event.clientX + (document.scrollLeft || document.body.scrollLeft);
      event.pageY = event.clientY + (document.scrollTop || document.body.scrollTop);
    }

    if (!event.target && event.srcElement)
      event.target = event.srcElement;

    if (event.type == "keypress") {
      if (event.charCode === 0 || event.charCode == undefined)
        event.code = event.keyCode;
      else
        event.code = event.charCode;
      event.character = String.fromCharCode(event.code);
    }
    return event;
  },

  // Portably register event handlers.
  connect: function connect(node, type, handler) {
    function wrapHandler(event) {
      handler(Util.normalizeEvent(event || window.event));
    }
    if (typeof node.addEventListener == "function") {
      node.addEventListener(type, wrapHandler, false);
      return function() { node.removeEventListener(type, wrapHandler, false); };
    }
    else {
      node.attachEvent("on" + type, wrapHandler);
      return function() { node.detachEvent("on" + type, wrapHandler); };
    }
  },
  disconnect: function disconnect(handler) {
    handler();
  },

  // Collections
  forEach: function forEach(collection, action) {
    var l = collection.length;
    for (var i = 0; i < l; ++i)
      action(collection[i], i);
  },
  map: function map(func, collection) {
    var l = collection.length, result = [];
    for (var i = 0; i < l; ++i)
      result.push(func(collection[i]));
    return result;
  },
  filter: function filter(pred, collection) {
    var result = [], l = collection.length;
    for (var i = 0; i < l; ++i) {
      var cur = collection[i];
      if (pred(cur)) result.push(cur);
    }
    return result;
  },
  forEachIn: function forEachIn(object, action) {
    for (var property in object) {
      if (Object.prototype.hasOwnProperty.call(object, property))
        action(property, object[property]);
    }
  },

  // Objects
  fill: function fill(dest, source) {
    Util.forEachIn(source, function(name, val) {dest[name] = val;});
  },

  // XHR
  makeXHR: (function() {
    var tries = [function() {return new XMLHttpRequest();},
                 function() {return new ActiveXObject('Msxml2.XMLHTTP');},
                 function() {return new ActiveXObject('Microsoft.XMLHTTP');}];
    var make = function() {throw new Error("XMLHttpRequest not supported by browser.");};
    for (var i = 0; i < tries.length; ++i) {
      try {
        tries[i]();
        make = tries[i];
        break;
      }
      catch (e) {}
    }
    return make;
  })(),
  httpRequest: function httpRequest(url, args, success, failure) {
    var xhr = Util.makeXHR();
    args = args || {};
    if (args.query) {
      var query = Util.queryString(args.query);
      if (query.length) url += "?" + query;
    }

    xhr.open(args.method || "GET", url, true);
    if (args.accept) xhr.setRequestHeader("Accept", args.accept);
    if (args.contentType) xhr.setRequestHeader("Content-Type", args.contentType);
    if (args.headers) {
      Util.forEachIn(args.headers, function(name, val) {
        xhr.setRequestHeader(name, val);
      });
    }
    xhr.onreadystatechange = function() {
      if (xhr.readyState == 4) {
        var ok = null;
        try {ok = (xhr.status == 200 || xhr.status == 204);}
        catch(e) {failure((e && typeof(e) == "object" && e.message) || String(e), xhr);}

        if (ok == true) {
          success(xhr.responseText);
        }
        else if (ok == false) {
          var text = "No response";
          try {text = xhr.responseText;} catch(e){}
          if (/<html/i.test(text))
            try {text = xhr.statusText;} catch(e){}
          failure(text, {status: xhr.status, url: url, method: args.method || "GET"});
        }
      }
    };
    if (typeof args.body == "object")
      args.body = Util.queryString(args.body);
    xhr.send(args.body || null);
  },
  queryString: function(map) {
    var acc = [];
    function add(name, val) {
      acc.push(name + "=" + val);
    }
    forEachIn(map, function(name, val) {
      var type = typeof val;
      if (val == null) return;
      else if (type == "boolean") add(name, val ? "true" : "false");
      else if (type == "string") add(name, encodeURIComponent(val));
      else if (type == "number") add(name, val);
      else if (val.length != null) {
        for (var i = 0; i < val.length; ++i)
          doEncode(name, val[i]);
      }
      else throw new Error("Can not encode " + val);
    });
    return acc.join("&");
  },
  url: function() {
    var accum = [];
    for (var i = 0; i < arguments.length; ++i) {
      var arg = arguments[i];
      if (typeof arg == "object")
        accum.push("?", queryString(arg));
      else if (i % 2)
        accum.push(encodeURIComponent(arg));
      else
        accum.push(arg);
    }
    return accum.join("");
  },

  // JSON
  readJSON: (function() {
    function evalRead(string) {return eval("(" + string + ")");}
    if (window.JSON)
      return function(string){try{return JSON.parse(string);}catch(e){return evalRead(string);}};
    else
      return evalRead;
  })(),
  writeJSON: window.JSON ? window.JSON.stringify : (function() {
    var specialChar = {'"': '\\"', "\\": "\\\\", "\f": "\\f", "\b": "\\b",
                       "\n": "\\n", "\t": "\\t", "\r": "\\r", "\v": "\\v"};
    function writeString(str) {
      return '"' + str.replace(/[\"\\\f\b\n\t\r\v]/g, function(c) {return specialChar[c];}) + '"';
    }
    function writeObject(obj) {
      var parts = ["{"], first = true;
      Util.forEachIn(obj, function(name, value) {
        if (first) first = false;
        else parts.push(", ");
        parts.push(writeString(name) + ": " + writeJSON(value));
      });
      parts.push("}");
      return parts.join("");
    }

    function writeJSON(value) {
      var type = typeof value;
      if (value === null)
        return "null";
      if (type == "object" && value instanceof Array)
        return "[" + Util.map(writeJSON, value).join(", ") + "]";
      else if (type == "object")
        return writeObject(value);
      else if (type == "string")
        return writeString(value);
      else
        return String(value);
    }
    return writeJSON;
  })(),

  // Cookies
  setCookie: function setCookie(name, value, expires) {
    var expirepart = "";
    if (expires !== true)
      expirepart = "; expires=" + (expires || new Date(2030, 1, 1)).toGMTString();
    document.cookie = name + "=" + value + expirepart + "; path=/";
  },
  delCookie: function delCookie(name) {
    Util.setCookie(name, "", new Date(2000, 1, 1));
  },
  getCookie: function getCookie(name) {
    var cookies = document.cookie.split(";"),
        test = new RegExp("^\\s*" + name + "=(.*)$"), match;
    for (var i = 0; i < cookies.length; ++i) {
      if (match = cookies[i].match(test))
        return match[1];
    }
    return null;
  }
};

Util.fill(window, Util);
