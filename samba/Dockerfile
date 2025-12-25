FROM dperson/samba:latest

# Install inotify-tools for real-time file watching
RUN apk add --no-cache inotify-tools

# Copy config template and sync script
COPY smb.conf.template /smb.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
