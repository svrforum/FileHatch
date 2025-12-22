FROM dperson/samba:latest

# Install inotify-tools for real-time file watching
RUN apk add --no-cache inotify-tools

# Copy sync script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
