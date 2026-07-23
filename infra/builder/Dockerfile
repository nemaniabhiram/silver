# The sandbox untrusted build scripts run inside. It carries a toolchain and
# nothing else — the project arrives on a bind mount at /workspace, and the
# container is discarded when the build ends.
#
# node:20-alpine already provides uid/gid 1000 as the `node` user, which is what
# the worker passes to --user so nothing runs as root.
FROM node:20-alpine

WORKDIR /workspace

CMD ["sh"]
