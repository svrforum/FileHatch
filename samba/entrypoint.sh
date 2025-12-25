#!/bin/bash
set -e

SYNC_FILE="/etc/scv/smb_users.txt"
SYNC_DIR="/etc/scv"
AUDIT_LOG="/etc/scv/smb_audit.log"

echo "[SCV-Samba] Starting user sync service..."

# Copy default smb.conf if not exists
if [ ! -f "/etc/samba/smb.conf" ] && [ -f "/smb.conf.template" ]; then
    echo "[SCV-Samba] Installing default smb.conf..."
    cp /smb.conf.template /etc/samba/smb.conf
fi

# Create users group if not exists
groupadd -f users 2>/dev/null || true

# Ensure directories exist
mkdir -p /data/users /data/shared /var/log/samba
chmod 775 /data/shared
chown root:users /data/shared 2>/dev/null || true

# Fix permissions on all subdirectories in /data/shared
# This ensures SMB users can write to shared folders
echo "[SCV-Samba] Fixing shared folder permissions..."
find /data/shared -type d -exec chmod 775 {} \; 2>/dev/null || true
find /data/shared -type d -exec chown :users {} \; 2>/dev/null || true

# Create audit log file
echo "[SCV-Samba] Setting up audit logging..."
touch "$AUDIT_LOG"
chmod 644 "$AUDIT_LOG"

# Start audit log watcher - monitors smbd logs for SMB_AUDIT entries
# and writes them to the shared audit log file
(
    echo "[SCV-Samba] Starting audit log watcher..."
    tail -F /var/log/samba/*.log 2>/dev/null | while read -r line; do
        if [[ "$line" == *"SMB_AUDIT"* ]]; then
            echo "$(date '+%b %d %H:%M:%S') $line" >> "$AUDIT_LOG"
        fi
    done
) &

# Sync users from file
sync_users() {
    if [ -f "$SYNC_FILE" ]; then
        echo "[SCV-Samba] Syncing users from file..."

        while IFS=: read -r username password || [[ -n "$username" ]]; do
            # Skip empty lines and comments
            [[ -z "$username" || "$username" =~ ^# ]] && continue

            # Create Linux user if not exists
            if ! id "$username" &>/dev/null; then
                useradd -M -s /usr/sbin/nologin -G users "$username" 2>/dev/null || true
                echo "[SCV-Samba] Created Linux user: $username"
            fi

            # Create user home directory
            mkdir -p "/data/users/$username"
            chown "$username:users" "/data/users/$username" 2>/dev/null || true
            chmod 755 "/data/users/$username"

            # Set Samba password
            if [ -n "$password" ]; then
                (echo "$password"; echo "$password") | smbpasswd -a -s "$username" 2>/dev/null
                smbpasswd -e "$username" 2>/dev/null || true
                echo "[SCV-Samba] Updated Samba user: $username"
            fi
        done < "$SYNC_FILE"

        echo "[SCV-Samba] User sync completed."
    fi
}

# Initial sync
sync_users

# Real-time file watcher in background
(
    echo "[SCV-Samba] Starting real-time file watcher..."
    mkdir -p "$SYNC_DIR"

    while true; do
        # Watch for file changes (modify, create, move)
        inotifywait -q -e modify,create,moved_to "$SYNC_DIR" 2>/dev/null

        # Small delay to ensure file write is complete
        sleep 0.5

        if [ -f "$SYNC_FILE" ]; then
            echo "[SCV-Samba] Detected change in sync file, reloading users..."
            sync_users
        fi
    done
) &

echo "[SCV-Samba] User sync service started."

# Call original entrypoint
exec /sbin/tini -- /usr/bin/samba.sh "$@"
