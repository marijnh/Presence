# Presence

## A different way to read IRC

Presence is an IRC logger and client that is optimized for my specific
use of IRC — scan logs for a few specific channels, respond to direct
messages and mentions, and only occasionally participate in
discussion. It probably won't work for you if you're a heavy IRC user.

Presence consists of a server process that logs a single IRC channel,
and acts as a proxy for a client, which is implemented as a web page.

The client provides the features of a minimal IRC client, minus any
multi-channel functionality. It remembers the furthest it was ever
scrolled down, and will pop up scrolled to that position when opened
again (even from a different browser or device).

At the bottom of the client's output is an input element through which
a user can write in the channel, with supports a minimal set of
commands: `/msg`, `/me`, `/whois`, and `/names`, and auto-completion
for commands and user names with `ctrl-space`.

The title of the tab will show the number of unread direct messages
and mentions for your user.

To run, start `serve.js` passing at least these three parameters:

    node serve.js irc.myserver.org myusername thechannel

The web server port will default to 8080. You can pass a `--port`
argument to use something else. Presence doesn't do any
authentication, and allows anyone who accesses the page to write on
your behalf, so you'll probably want to run it through a reverse-proxy
which does some kind of authenticating.
