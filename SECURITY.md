# Security policy

## Supported versions

Only the latest release on `main` is supported.

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within 7 days.

## Scope

The app runs entirely in your browser. It has no server and sends no data anywhere; it only talks to a mouse you pick in the browser's own device chooser. The most relevant reports would be:

- a way for a web page to send unexpected commands to the mouse;
- problems with the udev rule in `linux/` granting more access than intended;
- the installer writing files outside its stated locations.
