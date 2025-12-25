FROM ghcr.io/servercontainers/samba:latest

# Install inotify-tools for real-time file watching and syslog for audit
RUN apk add --no-cache inotify-tools bash rsyslog

# Configure rsyslog to capture SMB audit logs
RUN mkdir -p /etc/rsyslog.d && \
    echo 'local7.* /var/log/samba/smb_audit.log' > /etc/rsyslog.d/smb_audit.conf

# Copy config template and sync script
COPY smb.conf.template /smb.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Override the default entrypoint
ENTRYPOINT ["/entrypoint.sh"]
